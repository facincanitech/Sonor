package com.facincanitech.sonorhub;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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

    // Mantido só pra não quebrar quem já chama do JS (playerTogglePlayPause
    // etc.) — não controla mais nenhum botão de janela PiP, não existe mais.
    @PluginMethod
    public void setPaused(PluginCall call) {
        call.resolve();
    }
}
