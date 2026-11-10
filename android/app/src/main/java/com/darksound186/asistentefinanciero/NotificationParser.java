package com.darksound186.asistentefinanciero;

import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class NotificationParser {
    static final String TYPE_PURCHASE = "purchase";
    static final String TYPE_TRANSFER_SENT = "transfer_sent";
    static final String TYPE_TRANSFER_RECEIVED = "transfer_received";
    static final String TYPE_TRANSFER_UNKNOWN = "transfer_unknown";
    static final String TYPE_INCOME = "income";
    static final String TYPE_REFUND = "refund";
    static final String TYPE_INFORMATIONAL = "informational";
    static final String TYPE_UNKNOWN = "unknown";

    private static final Pattern MONEY = Pattern.compile(
            "(?i)(?:COP\\s*)?\\$\\s*([0-9][0-9.,]*)|\\b([0-9][0-9.,]*)\\s*(?:COP|pesos)\\b");
    private static final Pattern FOREIGN_CURRENCY = Pattern.compile(
            "(?i)\\b(USD|EUR|MXN|BRL|GBP|CAD|AUD)\\b|US\\$|€");
    private static final Pattern REFUND = Pattern.compile(
            "(?i)\\b(devoluci[oó]n|reembolso|reverso|refund|reversal|chargeback)\\b");
    private static final Pattern TRANSFER_RECEIVED = Pattern.compile(
            "(?i)\\b(transferencia\\s+(?:recibida|entrante)|recibiste\\s+(?:una\\s+)?transferencia|te\\s+transfirieron|incoming\\s+transfer|transfer\\s+received)\\b");
    private static final Pattern TRANSFER_SENT = Pattern.compile(
            "(?i)\\b(transferencia\\s+enviada|transferiste|enviaste|env[ií]o\\s+a|outgoing\\s+transfer|transfer\\s+sent|sent\\s+transfer)\\b");
    private static final Pattern TRANSFER = Pattern.compile(
            "(?i)\\b(transferencia|transfer)\\b");
    private static final Pattern INCOME = Pattern.compile(
            "(?i)\\b(abono|consignaci[oó]n|dep[oó]sito|ingreso|received\\s+payment|deposit\\s+received)\\b");
    private static final Pattern PURCHASE = Pattern.compile(
            "(?i)\\b(compra|compraste|consumo|pagaste|pago\\s+(?:en|a)|cobro|cargo|purchase|payment\\s+(?:at|to)|paid\\s+at)\\b");
    private static final Pattern INFORMATIONAL = Pattern.compile(
            "(?i)\\b(saldo|balance|resumen|extracto|statement|recordatorio|promoci[oó]n|oferta|cupo|l[ií]mite|available\\s+balance|fecha\\s+de\\s+corte)\\b");
    private static final Pattern GROUPED_INTEGER = Pattern.compile(
            "[0-9]{1,3}(?:[.,][0-9]{3})+");

    private NotificationParser() {}

    static String classify(String text) {
        if (text == null || text.trim().isEmpty()) return TYPE_UNKNOWN;
        if (REFUND.matcher(text).find()) return TYPE_REFUND;
        if (TRANSFER_RECEIVED.matcher(text).find()) return TYPE_TRANSFER_RECEIVED;
        if (TRANSFER_SENT.matcher(text).find()) return TYPE_TRANSFER_SENT;
        if (TRANSFER.matcher(text).find()) return TYPE_TRANSFER_UNKNOWN;
        if (INCOME.matcher(text).find()) return TYPE_INCOME;
        if (PURCHASE.matcher(text).find()) return TYPE_PURCHASE;
        if (INFORMATIONAL.matcher(text).find()) return TYPE_INFORMATIONAL;
        return TYPE_UNKNOWN;
    }

    static Long extractUniqueCopAmount(String text) {
        if (text == null || FOREIGN_CURRENCY.matcher(text).find()) return null;
        Matcher matcher = MONEY.matcher(text);
        Set<Long> amounts = new HashSet<>();
        while (matcher.find()) {
            String token = matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
            Long amount = parseCopInteger(token);
            if (amount == null) return null;
            amounts.add(amount);
            if (amounts.size() > 1) return null;
        }
        return amounts.isEmpty() ? null : amounts.iterator().next();
    }

    private static Long parseCopInteger(String token) {
        if (token == null || token.isEmpty()) return null;
        String digits = token;
        if (token.contains(".") || token.contains(",")) {
            if (!GROUPED_INTEGER.matcher(token).matches()) return null;
            digits = token.replace(".", "").replace(",", "");
        }
        try {
            long amount = Long.parseLong(digits);
            return amount > 0 && amount <= 100_000_000L ? amount : null;
        } catch (NumberFormatException error) {
            return null;
        }
    }
}
