package com.darksound186.asistentefinanciero;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

final class ExpenseSources {
    private static final Map<String, String> PROVIDERS;
    private static final Map<String, Set<String>> OFFICIAL_SHA256_CERTIFICATES;

    static {
        Map<String, String> providers = new HashMap<>();
        providers.put("com.nequi.MobileApp", "Nequi");
        providers.put("co.com.bancolombia.personas.superapp", "Bancolombia");
        providers.put("com.nu.production", "Nu");
        providers.put("com.google.android.apps.walletnfcrel", "Google Wallet");
        PROVIDERS = Collections.unmodifiableMap(providers);
        // Populate only with SHA-256 values from the publisher's Play Console app-signing certificate.
        OFFICIAL_SHA256_CERTIFICATES = Collections.emptyMap();
    }

    private ExpenseSources() {}

    static String providerForPackage(String packageName) {
        return PROVIDERS.get(packageName);
    }

    static boolean isKnownProvider(String provider) {
        return PROVIDERS.containsValue(provider);
    }

    static boolean isKnownProviderLabel(String providerLabel) {
        if (isKnownProvider(providerLabel)) return true;
        if (providerLabel == null || !providerLabel.endsWith(" (firma sin verificar)")) return false;
        return isKnownProvider(providerLabel.substring(0, providerLabel.length() - " (firma sin verificar)".length()));
    }

    static String unverifiedLabel(String provider) {
        return isKnownProvider(provider) ? provider + " (firma sin verificar)" : null;
    }

    static boolean isOfficiallyVerified(PackageManager packageManager, String packageName) {
        Set<String> expected = OFFICIAL_SHA256_CERTIFICATES.get(packageName);
        if (!PROVIDERS.containsKey(packageName) || expected == null || expected.isEmpty()) return false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                for (String fingerprint : expected) {
                    if (packageManager.hasSigningCertificate(
                            packageName, decodeFingerprint(fingerprint), PackageManager.CERT_INPUT_SHA256)) return true;
                }
                return false;
            }
            return hasLegacySigningCertificate(packageManager, packageName, expected);
        } catch (PackageManager.NameNotFoundException | IllegalArgumentException error) {
            return false;
        }
    }

    private static boolean hasLegacySigningCertificate(
            PackageManager packageManager, String packageName, Set<String> expected)
            throws PackageManager.NameNotFoundException {
        @SuppressWarnings("deprecation")
        PackageInfo info = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES);
        if (info.signatures == null) return false;
        for (Signature signature : info.signatures) {
            try {
                String fingerprint = toHex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()));
                if (expected.contains(fingerprint)) return true;
            } catch (NoSuchAlgorithmException error) {
                return false;
            }
        }
        return false;
    }

    private static byte[] decodeFingerprint(String fingerprint) {
        if (fingerprint == null || !fingerprint.matches("(?i)[0-9a-f]{64}")) {
            throw new IllegalArgumentException("Invalid signing certificate fingerprint.");
        }
        byte[] result = new byte[32];
        for (int i = 0; i < result.length; i++) {
            result[i] = (byte) Integer.parseInt(fingerprint.substring(i * 2, i * 2 + 2), 16);
        }
        return result;
    }

    private static String toHex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value));
        return result.toString();
    }
}
