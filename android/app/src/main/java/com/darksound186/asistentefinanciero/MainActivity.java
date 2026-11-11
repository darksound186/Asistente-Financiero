package com.darksound186.asistentefinanciero;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.regex.Pattern;

public final class MainActivity extends Activity {
    private static final int REQUEST_NOTIFICATIONS = 3101;
    private static final int BACKGROUND = Color.rgb(16, 17, 20);
    private static final int SURFACE = Color.rgb(25, 27, 32);
    private static final int TEXT = Color.rgb(245, 245, 245);
    private static final int MUTED = Color.rgb(146, 149, 158);
    private static final int ACCENT = Color.rgb(139, 207, 173);
    private static final long MAX_AMOUNT = 100_000_000L;
    private static final Pattern CAPTURE_ID = Pattern.compile("^[a-f0-9]{64}$");
    private static final String APP_URL = "https://darksound186.github.io/Asistente-Financiero/";
    private static final String APP_HOST = "darksound186.github.io";
    private static final String PREFS = "billetera_detection";
    private static final String[] PROVIDERS = {"Nequi", "Bancolombia", "Nu", "Google Wallet"};
    private TextView status;
    private WebView webView;
    private JSONObject pendingExpense;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(BACKGROUND);
        pendingExpense = expenseFromIntent(getIntent());
        buildScreen();
        if (webView != null) {
            webView.loadUrl(APP_URL);
        }
        if (!hasNotificationAccess()) {
            new android.app.AlertDialog.Builder(this)
                    .setTitle("Activa la detección de compras")
                    .setMessage("Android necesita tu permiso para que Billetera lea las notificaciones seleccionadas. El contenido se procesa en este dispositivo y no se envía a un servidor.")
                    .setNegativeButton("Ahora no", null)
                    .setPositiveButton("Configurar", (dialog, which) -> openNotificationAccessSettings())
                    .show();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateStatus();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        pendingExpense = expenseFromIntent(intent);
        deliverPendingExpense();
    }

    private void buildScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BACKGROUND);

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.VERTICAL);
        controls.setBackgroundColor(SURFACE);
        controls.setPadding(dp(16), dp(12), dp(16), dp(8));

        TextView title = new TextView(this);
        title.setText("Detección de compras");
        title.setTextSize(20);
        title.setTextColor(TEXT);
        controls.addView(title);

        status = new TextView(this);
        status.setTextSize(14);
        status.setPadding(0, dp(6), 0, dp(6));
        controls.addView(status);

        Button permissionButton = new Button(this);
        permissionButton.setText("Configurar acceso a notificaciones");
        permissionButton.setOnClickListener(view -> requestDetectionPermissions());
        controls.addView(permissionButton);

        TextView providerTitle = new TextView(this);
        providerTitle.setText("Apps que pueden generar avisos");
        providerTitle.setTextSize(14);
        providerTitle.setTextColor(TEXT);
        providerTitle.setPadding(0, dp(6), 0, 0);
        controls.addView(providerTitle);
        for (String provider : PROVIDERS) {
            CheckBox checkBox = new CheckBox(this);
            checkBox.setText(provider);
            checkBox.setTextColor(TEXT);
            checkBox.setChecked(getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(providerKey(provider), true));
            checkBox.setOnCheckedChangeListener((button, checked) ->
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(providerKey(provider), checked).apply());
            controls.addView(checkBox);
        }

        TextView privacy = new TextView(this);
        privacy.setText("Solo se revisan avisos de estas apps que parezcan compras. No se leen mensajes ni se guardan notificaciones ajenas.");
        privacy.setTextSize(12);
        privacy.setTextColor(MUTED);
        privacy.setPadding(0, dp(4), 0, dp(4));
        controls.addView(privacy);
        root.addView(controls, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                deliverPendingExpense();
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
    }

    private void requestDetectionPermissions() {
        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
            return;
        }
        openNotificationAccessSettings();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_NOTIFICATIONS &&
                grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            openNotificationAccessSettings();
        } else if (requestCode == REQUEST_NOTIFICATIONS) {
            Toast.makeText(this, "Sin permiso para mostrar avisos de compras.", Toast.LENGTH_LONG).show();
        }
    }

    private void openNotificationAccessSettings() {
        startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
    }

    private boolean hasNotificationAccess() {
        String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(getPackageName());
    }

    private void updateStatus() {
        if (status == null) return;
        boolean enabled = hasNotificationAccess();
        status.setText(enabled
                ? "Detección activa. Es posible que debas habilitar también las notificaciones de Billetera."
                : "Detección inactiva: autoriza el acceso especial de notificaciones de Android.");
        status.setTextColor(enabled ? ACCENT : MUTED);
    }

    private void deliverPendingExpense() {
        if (webView == null || pendingExpense == null) return;
        String encoded = JSONObject.quote(pendingExpense.toString());
        webView.evaluateJavascript(
                "(function(){return typeof window.receiveNativeExpense === 'function' && window.receiveNativeExpense(" + encoded + ");})()",
                result -> {
                    if ("true".equals(result)) {
                        pendingExpense = null;
                        Toast.makeText(this, "Compra enviada a Billetera.", Toast.LENGTH_SHORT).show();
                    }
                });
    }

    private JSONObject expenseFromIntent(Intent intent) {
        if (intent == null || !intent.hasExtra(SaveExpenseReceiver.EXTRA_CAPTURE_ID)) return null;
        String captureId = intent.getStringExtra(SaveExpenseReceiver.EXTRA_CAPTURE_ID);
        String source = intent.getStringExtra(SaveExpenseReceiver.EXTRA_SOURCE);
        String description = intent.getStringExtra(SaveExpenseReceiver.EXTRA_DESCRIPTION);
        String occurredAt = intent.getStringExtra(SaveExpenseReceiver.EXTRA_OCCURRED_AT);
        long amount = intent.getLongExtra(SaveExpenseReceiver.EXTRA_AMOUNT, 0);
        if (captureId == null || !CAPTURE_ID.matcher(captureId).matches() ||
                !ExpenseSources.isKnownProviderLabel(source) ||
                amount <= 0 || amount > MAX_AMOUNT ||
                occurredAt == null ||
                description == null || description.trim().isEmpty() || description.length() > 200) {
            Toast.makeText(this, "No se guardó el movimiento porque sus datos no son válidos.", Toast.LENGTH_LONG).show();
            return null;
        }
        try {
            Instant.parse(occurredAt);
            JSONObject expense = new JSONObject();
            expense.put("captureId", captureId);
            expense.put("amount", amount);
            expense.put("source", source);
            expense.put("description", description.trim());
            expense.put("occurredAt", occurredAt);
            return expense;
        } catch (JSONException | DateTimeParseException error) {
            Toast.makeText(this, "No se pudo preparar el movimiento revisado.", Toast.LENGTH_LONG).show();
            return null;
        }
    }

    private static String providerKey(String provider) {
        return "provider_" + provider.toLowerCase(java.util.Locale.ROOT).replace(' ', '_');
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
