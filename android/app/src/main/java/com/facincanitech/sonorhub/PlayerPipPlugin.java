package com.facincanitech.sonorhub;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// Ponte JS <-> estado de reprodução do Player, usada pra decidir se
// minimizar o app sobe a notificação de mídia (ver PlayerForegroundService
// e MainActivity) e se a tela deve ficar acesa enquanto toca. O modo
// Picture-in-Picture de verdade foi removido (16/08/2026, a pedido do
// usuário — a janelinha flutuante tinha virado inútil no dia a dia); a
// notificação com controles (voltar/play-pause/avançar) continua sozinha,
// sem precisar de PiP pra existir.
@CapacitorPlugin(name = "PlayerPip")
public class PlayerPipPlugin extends Plugin {
    public static final String ACTION_PIP_CONTROL = "infohub.PIP_CONTROL";
    public static final String EXTRA_CONTROL = "control"; // "previous" | "playpause" | "next"

    private static PlayerPipPlugin activeInstance;
    private static boolean playbackActive = false;
    // Rádio/Audiobook sobrevivem à tela travada (áudio puro/TTS, sem
    // decodificador de vídeo) — só eles devem acender a notificação. Música/
    // Vídeo (YouTube) param de qualquer jeito quando a tela trava; mostrar
    // notificação ali é só promessa vazia, então não acende pra esse caso.
    private static boolean notificationCapable = false;

    // "Now playing" pra notificação — 22/08/2026, a notificação ficava sempre
    // com texto genérico e ícone de pausa fixo, sem refletir a rádio/estado
    // real. Guardado aqui (não só no serviço) porque o serviço só existe
    // enquanto o app tá minimizado; o plugin sobrevive o tempo todo.
    private static String nowTitle = "SonorHub Player";
    private static String nowSubtitle = "Tocando em segundo plano";
    private static Bitmap nowImage;
    private static boolean nowPaused = false;

    @Override
    public void load() {
        activeInstance = this;
    }

    public static boolean isPlaybackActive() {
        return playbackActive;
    }

    public static boolean isNotificationCapable() {
        return notificationCapable;
    }

    public static String getNowTitle() { return nowTitle; }
    public static String getNowSubtitle() { return nowSubtitle; }
    public static Bitmap getNowImage() { return nowImage; }
    public static boolean isNowPaused() { return nowPaused; }

    public static void emitControlIfActive(String control) {
        if (activeInstance != null) activeInstance.emitControl(control);
    }

    private void emitControl(String control) {
        JSObject data = new JSObject();
        data.put("control", control);
        notifyListeners("pipControl", data);
    }

    // JS chama isso quando começa/para de tocar algo no Player — controla se
    // minimizar o app sobe a notificação com controles (ver MainActivity).
    @PluginMethod
    public void setActive(PluginCall call) {
        playbackActive = Boolean.TRUE.equals(call.getBoolean("active", false));
        notificationCapable = playbackActive && Boolean.TRUE.equals(call.getBoolean("notificationCapable", false));
        // Vídeo do YouTube não sobrevive ao apagar automático da tela por
        // inatividade (mesmo limite de Surface já documentado) — pedir pra
        // tela não apagar sozinha enquanto isso tocar evita cair nesse caso
        // sem precisar contornar nada do YouTube. Não impede travar na mão
        // (botão de power), só o apagamento por tempo ocioso.
        boolean keepScreenOn = playbackActive && Boolean.TRUE.equals(call.getBoolean("keepScreenOn", false));
        // addFlags/clearFlags precisa da UI thread — Capacitor chama @PluginMethod
        // numa thread própria (CapacitorPlugins), não na main/UI, e o Android
        // rejeita com CalledFromWrongThreadException se tentar tocar na janela
        // de fora dela (era o crash no MultiSonor ao começar a tocar música).
        if (getActivity() != null) {
            final boolean shouldKeep = keepScreenOn;
            getActivity().runOnUiThread(() -> {
                if (shouldKeep) {
                    getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }
        call.resolve();
    }

    // Mantido só pra não quebrar quem já chama do JS — não controla mais
    // nenhum botão de janela PiP (não existe mais), mas ainda atualiza o
    // ícone de play/pause da notificação se ela já estiver de pé.
    @PluginMethod
    public void setPaused(PluginCall call) {
        nowPaused = Boolean.TRUE.equals(call.getBoolean("paused", false));
        PlayerForegroundService.refreshNotification();
        call.resolve();
    }

    // Nome/subtítulo/capa de que tá tocando agora (rádio, por enquanto) —
    // pra notificação parar de mostrar texto genérico fixo. imageUrl baixado
    // aqui mesmo, síncrono: @PluginMethod já roda fora da thread principal
    // (thread própria do Capacitor), então uma chamada de rede bloqueante
    // aqui não trava a UI.
    @PluginMethod
    public void setNowPlaying(PluginCall call) {
        nowTitle = call.getString("title", "SonorHub Player");
        nowSubtitle = call.getString("subtitle", "Tocando em segundo plano");
        nowPaused = Boolean.TRUE.equals(call.getBoolean("paused", false));
        String imageUrl = call.getString("imageUrl", "");
        nowImage = (imageUrl != null && !imageUrl.isEmpty()) ? baixarImagem(imageUrl) : null;
        PlayerForegroundService.refreshNotification();
        call.resolve();
    }

    private Bitmap baixarImagem(String urlStr) {
        try {
            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);
            conn.setInstanceFollowRedirects(true);
            try (InputStream in = conn.getInputStream()) {
                return BitmapFactory.decodeStream(in);
            } finally {
                conn.disconnect();
            }
        } catch (Exception e) {
            return null; // favicon quebrado/fora do ar — notificação cai pro ícone padrão
        }
    }
}
