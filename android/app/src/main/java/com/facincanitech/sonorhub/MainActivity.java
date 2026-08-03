package com.facincanitech.sonorhub;

import android.app.PictureInPictureParams;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;

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
        super.onCreate(savedInstanceState);
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
        // ele só passa por aqui (onStop), não por onUserLeaveHint/onPause a
        // tempo de entrar em PiP. isFinishing() exclui o caso de fechar de
        // verdade (botão Voltar na tela raiz) — aí não é pra abrir PiP.
        // Logcat confirmou que mesmo chamando imediato (sem delay) AQUI já é
        // tarde demais — a Activity já não está mais num estado que permite
        // PiP nesse ponto do ciclo de vida (mesma exceção "Activity must be
        // resumed"). Mantido só como tentativa de não perder nada em
        // aparelhos onde onPause/onUserLeaveHint não disparam a tempo, mas o
        // caminho que de fato funciona é o de onPause/onUserLeaveHint abaixo.
        if (!isFinishing()) tryEnterPip();
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
        // Voltou pra tela cheia de verdade (não só restaurou do PiP) — o app
        // já tá em primeiro plano normal, não precisa mais do serviço com
        // notificação pra manter prioridade.
        PlayerForegroundService.stop(this);
        // Rede de segurança: com autoEnterEnabled (Android 12+), a gente
        // avisa o JS pra preparar a tela cheia ANTES de saber se o sistema
        // vai mesmo entrar em PiP — se por algum motivo ele decidir não
        // entrar, isInPictureInPictureMode() aqui vai estar false e isso
        // desfaz o "modo preparação" que ficaria travado pra sempre (mesmo
        // bug do "tela presa preta/cinza" de antes, por outro caminho).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !isInPictureInPictureMode()) {
            PlayerPipPlugin.emitPipVisualModeIfActive(false);
        }
        // Voltar de um período longo de tela apagada (rádio tocando, tela
        // bloqueada) às vezes deixava a WebView com um repaint incompleto —
        // tela cinza até forçar via Home+gerenciador. Força um relayout aqui
        // como rede de segurança geral, não só pro caminho específico do PiP.
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
        // aparelhos/gestos não chamam ele) — tenta de novo aqui como reforço,
        // já que entrar em PiP enquanto já está em PiP é inofensivo (a chamada
        // simplesmente não faz nada/lança, cai no catch).
        tryEnterPip();
    }

    // Disparado quando o usuário sai do app (home, troca de app) — se tem
    // mídia tocando no Player, entra em PiP em vez de só minimizar normal.
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        tryEnterPip();
    }

    // Muitas rodadas tentando controlar a entrada em PiP manualmente
    // (onPause/onUserLeaveHint/onStop chamando enterPictureInPictureMode na
    // hora certa, com e sem delay) sempre bateram na mesma corrida contra o
    // sistema saindo do estado RESUMED — confirmado por Logcat real,
    // "Activity must be resumed" mesmo chamando de forma 100% síncrona.
    //
    // A partir do Android 12 (S) existe o jeito certo: autoEnterEnabled(true)
    // (configurado em PlayerPipPlugin.setActive, ANTES do usuário minimizar)
    // deixa o PRÓPRIO SISTEMA decidir o momento exato de entrar em PiP — sem
    // essa corrida, porque é tratado internamente pela plataforma, não pelo
    // nosso código tentando adivinhar o timing certo. Aqui só avisamos o JS
    // pra preparar a tela com antecedência (best-effort) e mantemos o
    // foreground service; NÃO chamamos enterPictureInPictureMode nós mesmos
    // nesse caso. Só em Android 8-11 (O a R), onde autoEnterEnabled não
    // existe, ainda precisamos chamar manualmente.
    private void tryEnterPip() {
        if (!PlayerPipPlugin.isPlaybackActive() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (isInPictureInPictureMode()) return;
        PlayerPipPlugin.emitPipVisualModeIfActive(true);
        // Só pra fontes que sobrevivem à tela travada (rádio/audiobook) —
        // pra música/vídeo (YouTube) a notificação seria promessa vazia, já
        // que o som para de qualquer jeito quando a tela trava.
        if (PlayerPipPlugin.isNotificationCapable()) PlayerForegroundService.start(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return; // deixa o autoEnterEnabled cuidar
        try {
            enterPictureInPictureMode(PlayerPipPlugin.buildPipParams(this));
        } catch (Exception e) {
            android.util.Log.e("InfoHubPip", "Falha ao entrar em PiP: " + e.getMessage(), e);
            // Já tínhamos avisado o JS pra preparar a tela cheia (entering=true)
            // antes de tentar — se a entrada falhou (tela bloqueando, ou em
            // alguns aparelhos ao abrir o gerenciador de apps), isso nunca se
            // desfazia, e a tela ficava travada preta/cinza até forçar via
            // Home+PiP. Desfaz na hora, já que não tem PiP de verdade pra
            // animar a volta.
            PlayerPipPlugin.emitPipVisualModeIfActive(false);
        }
    }

    // PiP foi fechado (usuário arrastou pro X, ou voltou pro app normal)
    // — avisa o JS pra desfazer o "modo visual de PiP" e mostrar a tela
    // normal de novo. Se foi fechado de propósito enquanto a mídia ainda
    // devia tocar, também sobe o Foreground Service com a notificação.
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        android.view.View decor = getWindow().getDecorView();
        android.util.Log.d("InfoHubPip", "onPictureInPictureModeChanged: isInPip=" + isInPictureInPictureMode
            + " decorView=" + decor.getWidth() + "x" + decor.getHeight()
            + " newConfig.screenWidthDp=" + newConfig.screenWidthDp + " screenHeightDp=" + newConfig.screenHeightDp);
        if (!isInPictureInPictureMode) {
            PlayerPipPlugin.emitPipVisualModeIfActive(false);
            if (PlayerPipPlugin.isNotificationCapable()) {
                PlayerForegroundService.start(this);
            }
            // Log confirmou: nesse instante o decorView AINDA está no tamanho
            // pequeno do PiP — o resize de verdade pro tamanho cheio acontece
            // em paralelo, depois desse callback. Espera a animação de resize
            // do Android terminar antes de reconferir o tamanho da WebView,
            // senão mede o tamanho errado (pequeno) e trava isso.
            if (getBridge() != null && getBridge().getWebView() != null) {
                final android.webkit.WebView webView = getBridge().getWebView();
                webView.postDelayed(() -> {
                    android.util.Log.d("InfoHubPip", "Depois do delay+relayout — webView: " + webView.getWidth() + "x" + webView.getHeight());
                    webView.requestLayout();
                    webView.invalidate();
                }, 350);
            }
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
