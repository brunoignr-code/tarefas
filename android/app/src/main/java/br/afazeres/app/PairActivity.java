package br.afazeres.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * Recebe do app web o código de uso único (afazeres://parear?c=…), troca pela chave de alarme
 * deste celular, pede as permissões do Android e busca a agenda. Sem tela própria: ao terminar,
 * volta para o app.
 */
public class PairActivity extends Activity {
    private static final int ASK_NOTIFICATIONS = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri data = getIntent().getData();
        String code = data == null ? null : data.getQueryParameter("c");
        if (code == null || !code.matches("[0-9a-f]{32}")) {
            done("Código de alarmes inválido. Toque de novo em Ativar alarmes, no app.");
            return;
        }
        Alarms.ensureChannel(this);
        Alarms.IO.execute(() -> {
            try {
                JSONObject body = new JSONObject().put("code", code).put("name", deviceName());
                JSONObject res = Net.post("/alarms/claim", body, null, 15000);
                Alarms.saveToken(getApplicationContext(), res.getString("token"));
                runOnUiThread(this::askPermissions);
            } catch (Exception e) {
                runOnUiThread(() -> done("Não deu para ativar os alarmes: " + e.getMessage()));
            }
        });
    }

    private static String deviceName() {
        String model = Build.MODEL == null ? "Android" : Build.MODEL;
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        return model.toLowerCase().startsWith(maker.toLowerCase()) ? model : (maker + " " + model).trim();
    }

    private void askPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, ASK_NOTIFICATIONS);
            return;
        }
        afterPermissions();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == ASK_NOTIFICATIONS) afterPermissions();
    }

    private void afterPermissions() {
        // Android 12: alarme exato precisa ser liberado na tela "Alarmes e lembretes" (do 13 em diante, vem liberado).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !Alarms.canExact(this)) {
            try {
                startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName())));
            } catch (Exception ignored) {
                // Celular sem essa tela: segue com o alarme comum.
            }
        }
        RefreshJob.schedulePeriodic(this);
        Alarms.IO.execute(() -> {
            String message;
            try {
                boolean ok = Alarms.refresh(getApplicationContext());
                if (!ok) message = "Os alarmes não foram ativados. Tente de novo pelo app.";
                else if (!Alarms.canNotify(this)) message = "Alarmes ativados, mas as notificações do Afazeres estão desligadas no Android.";
                else message = "Alarmes ativados neste celular.";
            } catch (Exception e) {
                message = "Alarmes ativados. A agenda vem quando houver internet.";
            }
            String text = message;
            runOnUiThread(() -> done(text));
        });
    }

    private void done(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
        finish();
    }
}
