package org.box1.console.domain;

import java.util.Locale;

import org.box1.console.upstream.Payloads.UpTimelineEntry;

/** Human-readable sentence for one order-service timeline entry; the codes stay visible beside it. */
public final class TimelineText {
    private TimelineText() {
    }

    public static String describe(UpTimelineEntry e) {
        if ("TRANSITION".equals(e.kind())) {
            String to = StateLabels.label(e.toState());
            if (e.fromState() == null) {
                return to + ".";
            }
            return StateLabels.label(e.fromState()) + " → " + to + because(e);
        }
        return "Note: " + humanize(e.reasonCode()) + because(e);
    }

    private static String because(UpTimelineEntry e) {
        return e.eventType() == null ? "." : " (after " + e.eventType() + ").";
    }

    static String humanize(String code) {
        if (code == null || code.isBlank()) {
            return "recorded";
        }
        String text = code.replace('_', ' ').toLowerCase(Locale.ROOT);
        return Character.toUpperCase(text.charAt(0)) + text.substring(1);
    }
}
