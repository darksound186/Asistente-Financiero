package com.darksound186.asistentefinanciero;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;

import java.text.NumberFormat;
import java.util.Locale;
import java.util.regex.Pattern;

final class ExpenseNotifications {
    private static final String CHANNEL_ID = "detected_purchases";
    private static final String REMOTE_INPUT_KEY = "purchase_description";
    private static final String PREFS = "billetera_detection";
    private static final String CAPTURE_PREFIX = "capture_";
    private static final long MAX_AMOUNT = 100_000_000L;
    private static final Pattern CAPTURE_ID = Pattern.compile("^[a-f0-9]{64}$");

    private ExpenseNotifications() {}

    static void postPrompt(Context context, String source, long amount, String captureId,
                           long occurredAt, String suggestedType, boolean verified) {
        if (!ExpenseSources.isKnownProvider(source) || amount <= 0 ||
                amount > MAX_AMOUNT || occurredAt <= 0 ||
                captureId == null || !CAPTURE_ID.matcher(captureId).matches() ||
                !ReviewExpenseActivity.isKnownType(suggestedType)) return;
        storeCapture(context, source, amount, captureId, occurredAt, suggestedType, verified);

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID, "Movimientos detectados", NotificationManager.IMPORTANCE_HIGH));
        }

        int notificationId = captureId.hashCode() & 0x7fffffff;
        Intent replyIntent = new Intent(context, SaveExpenseReceiver.class)
                .putExtra(SaveExpenseReceiver.EXTRA_CAPTURE_ID, captureId);
        PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
                context, notificationId, replyIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);

        RemoteInput remoteInput = new RemoteInput.Builder(REMOTE_INPUT_KEY)
                .setLabel("Ej. almuerzo, mercado o transporte")
                .build();
        Notification.Action saveAction = new Notification.Action.Builder(
                android.R.drawable.ic_menu_search, "Revisar movimiento", replyPendingIntent)
                .addRemoteInput(remoteInput)
                .setAllowGeneratedReplies(false)
                .build();

        String amountText = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("es-CO"))
                .format(amount);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);
        Notification prompt = builder
                .setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setContentTitle((verified ? "Movimiento detectado en " : "Posible origen no verificado: ") + source)
                .setContentText(amountText + " · revisa el origen, tipo e importe antes de guardarlo")
                .setStyle(new Notification.BigTextStyle()
                        .bigText(amountText + " · " + source + ". Revisa el origen, tipo, importe y descripción antes de confirmar."))
                .setCategory(Notification.CATEGORY_REMINDER)
                .setAutoCancel(false)
                .addAction(saveAction)
                .build();
        try {
            manager.notify(notificationId, prompt);
        } catch (SecurityException error) {
            android.util.Log.e("BilleteraNotifications",
                    "Android no permitió publicar el aviso; revisa el permiso de notificaciones.", error);
        }
    }

    static String descriptionFromReply(Intent intent) {
        Bundle result = RemoteInput.getResultsFromIntent(intent);
        if (result == null) return "";
        CharSequence description = result.getCharSequence(REMOTE_INPUT_KEY);
        return description == null ? "" : description.toString().trim();
    }

    static Bundle loadCapture(Context context, String captureId) {
        if (captureId == null || !captureId.matches("[a-f0-9]{64}")) return null;
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String key = captureKey(captureId);
        if (!preferences.contains(key + "_amount")) return null;
        long amount = preferences.getLong(key + "_amount", 0);
        String source = preferences.getString(key + "_source", null);
        long occurredAt = preferences.getLong(key + "_time", 0);
        String type = preferences.getString(key + "_type", null);
        boolean verified = preferences.getBoolean(key + "_verified", false);
        if (amount <= 0 || amount > MAX_AMOUNT || occurredAt <= 0 ||
                !ExpenseSources.isKnownProvider(source) || !ReviewExpenseActivity.isKnownType(type)) return null;
        Bundle capture = new Bundle();
        capture.putString(SaveExpenseReceiver.EXTRA_CAPTURE_ID, captureId);
        capture.putLong(SaveExpenseReceiver.EXTRA_AMOUNT, amount);
        capture.putString(SaveExpenseReceiver.EXTRA_SOURCE, source);
        capture.putLong(SaveExpenseReceiver.EXTRA_OCCURRED_AT, occurredAt);
        capture.putString(SaveExpenseReceiver.EXTRA_SUGGESTED_TYPE, type);
        capture.putBoolean(SaveExpenseReceiver.EXTRA_SOURCE_VERIFIED, verified);
        return capture;
    }

    static void removeCapture(Context context, String captureId) {
        if (captureId == null || !captureId.matches("[a-f0-9]{64}")) return;
        String key = captureKey(captureId);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .remove(key + "_amount")
                .remove(key + "_source")
                .remove(key + "_time")
                .remove(key + "_type")
                .remove(key + "_verified")
                .apply();
    }

    static String captureKey(String captureId) {
        return CAPTURE_PREFIX + captureId;
    }

    private static void storeCapture(Context context, String source, long amount, String captureId,
                                     long occurredAt, String suggestedType, boolean verified) {
        String key = captureKey(captureId);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putLong(key + "_amount", amount)
                .putString(key + "_source", source)
                .putLong(key + "_time", occurredAt)
                .putString(key + "_type", suggestedType)
                .putBoolean(key + "_verified", verified)
                .apply();
    }
}
