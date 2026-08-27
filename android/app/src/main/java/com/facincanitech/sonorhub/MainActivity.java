package com.facincanitech.sonorhub;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    // Marcador exigido pelo plugin de login social pra liberar o pedido de
    // escopos extras do Google (Gmail/Calendar/Contacts/YouTube) — sem lógica própria.
    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}

    private boolean pipReceiverRegistered = false;
    private final BroadcastReceiver pipControlReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String control = intent.getStringExtra(PlayerPipPlugin.EXTRA_CONTROL);
            if (control != null) PlayerPipPlugin.emitControlIfActive(control);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BriefingAlarmPlugin.class);
        registerPlugin(SmsPlugin.class);
        registerPlugin(PlayerPipPlugin.class);
        registerPlugin(PhotoSyncPlugin.class);
        registerPlugin(DeviceInfoPlugin.class);
        super.onCreate(savedInstanceState);
        // O WebView tem a própria trava de "mixed content" pra recurso carregado
        // dentro de uma página (independente do usesCleartextTraffic do Manifest,
        // que só libera a Activity fazer requisição HTTP — não afeta o que o
        // WebView deixa um <audio>/<video> tocar de dentro da página). Sem isso,
        // rádio antiga em http:// (streams ShoutCast old-school) não tocava nem
        // no app nativo, só via ffmpeg (fora do navegador).
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        // Registrado aqui (e só desfeito em onDestroy) em vez de onStart/onStop:
        // os botões da notificação (visíveis na tela de bloqueio) precisam
        // funcionar mesmo com a Activity parada (onStop) — era exatamente esse
        // o motivo de "nav do Sonor não faz nada na tela bloqueada": o receiver
        // já tinha sido desregistrado antes do toque no botão da notificação.
        IntentFilter filter = new IntentFilter(PlayerPipPlugin.ACTION_PIP_CONTROL);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(pipControlReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(pipControlReceiver, filter);
        }
        pipReceiverRegistered = true;
    }

    @Override
    public void onStop() {
        super.onStop();
        // Reforço pro botão de "apps recentes" (Overview) — em alguns aparelhos
        // ele só passa por onStop, não por onUserLeaveHint/onPause a tempo.
        // isFinishing() exclui o caso de fechar de verdade (botão Voltar na
        // tela raiz) — aí não é pra subir notificação nenhuma.
        if (!isFinishing()) startNotificationIfPlaying();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (pipReceiverRegistered) {
            unregisterReceiver(pipControlReceiver);
            pipReceiverRegistered = false;
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        AppState.isForeground = true;
        // Voltou pra tela cheia — o app já tá em primeiro plano normal, não
        // precisa mais do serviço com notificação pra manter prioridade.
        PlayerForegroundService.stop(this);
        // Voltar de um período longo de tela apagada (rádio tocando, tela
        // bloqueada) às vezes deixava a WebView com um repaint incompleto —
        // tela cinza até forçar via Home+gerenciador. Força um relayout aqui
        // como rede de segurança.
        if (getBridge() != null && getBridge().getWebView() != null) {
            final android.webkit.WebView webView = getBridge().getWebView();
            webView.post(() -> {
                webView.requestLayout();
                webView.invalidate();
            });
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        AppState.isForeground = false;
        // onUserLeaveHint() não dispara em todo caminho de minimizar (alguns
        // aparelhos/gestos não chamam ele) — tenta de novo aqui como reforço.
        startNotificationIfPlaying();
    }

    // Disparado quando o usuário sai do app (home, troca de app) — se tem
    // mídia tocando no Player que sobrevive em segundo plano (rádio/
    // audiobook), sobe a notificação com controles.
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        startNotificationIfPlaying();
    }

    // Picture-in-Picture (janelinha flutuante) foi removido — virou inútil
    // no dia a dia (usuário pediu remoção, 16/08/2026). O que sobrevive é só
    // a notificação com controles (voltar/play-pause/avançar), que não
    // depende de PiP pra existir: ela sobe direto ao minimizar, sempre que
    // tem mídia tocando de um tipo que sobrevive em segundo plano (rádio/
    // audiobook — música/vídeo do YouTube param de qualquer jeito quando a
    // tela trava, não faz sentido notificação ali).
    private void startNotificationIfPlaying() {
        if (PlayerPipPlugin.isPlaybackActive() && PlayerPipPlugin.isNotificationCapable()) {
            PlayerForegroundService.start(this);
        }
    }

    // App já estava aberto (singleTask) quando o alarme disparou — avisa o JS
    // direto via evento, em vez de depender do consumePendingAlarm() do load inicial.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String time = intent.getStringExtra(BriefingAlarmPlugin.EXTRA_AUTOPLAY_TIME);
        if (time != null && getBridge() != null) {
            PluginHandle handle = getBridge().getPlugin("BriefingAlarm");
            if (handle != null) {
                Plugin plugin = handle.getInstance();
                if (plugin instanceof BriefingAlarmPlugin) {
                    ((BriefingAlarmPlugin) plugin).emitAlarmFired(time);
                }
            }
        }
    }
}
