package com.darksound186.asistentefinanciero;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public final class ExpenseNotificationListener extends NotificationListenerService {
    private static final String TAG = "BilleteraNotifications";
    private static final String PREFS = "billetera_detection";
    private static final String SEEN_KEY = "seen_captures";

    @Override
    public void onNotificationPosted(StatusBarNotification posted) {
        Notification notification = posted.getNotification();
        if ((notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0 ||
                (notification.flags & Notification.FLAG_ONGOING_EVENT) != 0 ||
                notification.extras == null) return;

        String source = ExpenseSources.providerForPackage(posted.getPackageName());
        if (source == null || !getSharedPreferences(PREFS, MODE_PRIVATE)
                .getBoolean(providerKey(source), true)) return;

        String text = notificationText(notification);
        if (text.isEmpty()) return;
        String suggestedType = NotificationParser.classify(text);
        if (NotificationParser.TYPE_INFORMATIONAL.equals(suggestedType)) return;
        Long amount = NotificationParser.extractUniqueCopAmount(text);
        if (amount == null) return;
        boolean verified = ExpenseSources.isOfficiallyVerified(
                getPackageManager(), posted.getPackageName());
        if (!verified) suggestedType = NotificationParser.TYPE_UNKNOWN;

        long occurredAt = notification.when > 0 ? notification.when : posted.getPostTime();
        String captureId = captureId(posted.getPackageName(), occurredAt, amount, text);
        if (!rememberOnce(captureId)) return;
        ExpenseNotifications.postPrompt(this, source, amount, captureId, occurredAt, suggestedType, verified);
    }

    private String notificationText(Notification notification) {
        ArrayList<String> parts = new ArrayList<>();
        append(parts, notification.extras.getCharSequence(Notification.EXTRA_TITLE));
        append(parts, notification.extras.getCharSequence(Notification.EXTRA_TEXT));
        append(parts, notification.extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        CharSequence[] lines = notification.extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (lines != null) {
            for (CharSequence line : lines) append(parts, line);
        }
        return String.join(" ", parts);
    }

    private void append(ArrayList<String> parts, CharSequence value) {
        if (value != null && value.length() > 0) parts.add(value.toString());
    }

    private String captureId(String packageName, long notificationTime, long amount, String text) {
        String value = packageName + "|" + notificationTime + "|" + amount + "|" + text;
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(64);
            for (byte item : digest) result.append(String.format(Locale.ROOT, "%02x", item));
            return result.toString();
        } catch (Exception error) {
            Log.e(TAG, "No se pudo generar el identificador de compra.", error);
            return null;
        }
    }

    private boolean rememberOnce(String captureId) {
        if (captureId == null) return false;
        Set<String> seen = new HashSet<>(getSharedPreferences(PREFS, MODE_PRIVATE)
                .getStringSet(SEEN_KEY, new HashSet<>()));
        if (!seen.add(captureId)) return false;
        android.content.SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        android.content.SharedPreferences.Editor editor = preferences.edit();
        while (seen.size() > 250) {
            String oldest = seen.iterator().next();
            seen.remove(oldest);
            ExpenseNotifications.removeCapture(this, oldest);
        }
        editor.putStringSet(SEEN_KEY, seen).apply();
        return true;
    }

    private static String providerKey(String provider) {
        return "provider_" + provider.toLowerCase(Locale.ROOT).replace(' ', '_');
    }
}
