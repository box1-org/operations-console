package org.box1.console.domain;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.fasterxml.jackson.core.type.TypeReference;
import io.smallrye.config.ConfigMapping;
import io.smallrye.config.WithDefault;
import jakarta.enterprise.context.ApplicationScoped;
import org.box1.console.upstream.Payloads.UpFulfillment;
import org.box1.console.upstream.Payloads.UpInfo;
import org.box1.console.upstream.Payloads.UpOrder;
import org.box1.console.upstream.Payloads.UpReservation;
import org.box1.console.upstream.Payloads.UpStock;
import org.box1.console.upstream.Payloads.UpTimelineEntry;
import org.box1.console.upstream.Source;
import org.box1.console.upstream.SourceStatus;
import org.box1.console.upstream.UpstreamResponse;
import org.box1.console.upstream.Upstreams;

/** Typed reads of each upstream's published API. Bounded: at most {@code maxPages} pages per list. */
@ApplicationScoped
public class ConsoleReads {
    private static final Pattern NEXT = Pattern.compile("<([^>]*)>\\s*;\\s*rel=\"?next\"?");
    private static final Pattern SAFE_ID = Pattern.compile("^(ord|res|ful)_[A-Za-z0-9_-]{1,64}$");
    private static final TypeReference<List<UpOrder>> ORDERS = new TypeReference<>() { };
    private static final TypeReference<UpOrder> ORDER = new TypeReference<>() { };
    private static final TypeReference<List<UpTimelineEntry>> TIMELINE = new TypeReference<>() { };
    private static final TypeReference<UpReservation> RESERVATION = new TypeReference<>() { };
    private static final TypeReference<UpFulfillment> FULFILLMENT = new TypeReference<>() { };
    private static final TypeReference<List<UpStock>> STOCK = new TypeReference<>() { };
    private static final TypeReference<UpInfo> INFO = new TypeReference<>() { };
    private static final TypeReference<Object> ANY = new TypeReference<>() { };

    private final Upstreams upstreams;
    private final Settings settings;

    public ConsoleReads(Upstreams upstreams, Settings settings) {
        this.upstreams = upstreams;
        this.settings = settings;
    }

    /** Console behaviour settings (decisions D-007, D-008, D-012, D-013). */
    @ConfigMapping(prefix = "console")
    public interface Settings {
        @WithDefault("none")
        String fulfillmentLink();

        @WithDefault("10m")
        Duration stuckThreshold();

        @WithDefault("2")
        int maxPages();

        @WithDefault("operations-console-dev")
        String environment();

        @WithDefault("https://asset-service-dev.apps.ocp.box1.org/console/")
        String telemetryConsoleUrl();

        Optional<String> publicOrigin();
    }

    public Settings settings() {
        return settings;
    }

    public record Listed<T>(List<T> items, boolean complete, SourceStatus status) {
    }

    public Listed<UpOrder> recentOrders() {
        return pages(Source.ORDER_SERVICE, "/api/v1/orders?limit=100", Optional.empty(), ORDERS);
    }

    public UpstreamResponse<UpOrder> order(String orderId) {
        return upstreams.get(Source.ORDER_SERVICE, "/api/v1/orders/" + id(orderId), Optional.empty(), ORDER);
    }

    public Listed<UpTimelineEntry> timeline(String orderId) {
        return pages(Source.ORDER_SERVICE, "/api/v1/orders/" + id(orderId) + "/timeline?limit=100", Optional.empty(), TIMELINE);
    }

    public UpstreamResponse<UpReservation> reservation(String reservationId, Optional<String> token) {
        return upstreams.get(Source.INVENTORY_SERVICE, "/api/v1/reservations/" + id(reservationId), token, RESERVATION);
    }

    public UpstreamResponse<UpFulfillment> fulfillment(String fulfillmentRequestId, Optional<String> token) {
        return upstreams.get(Source.FULFILLMENT_ADAPTER, "/api/fulfillments/" + id(fulfillmentRequestId), token, FULFILLMENT);
    }

    public Listed<UpStock> stock(Optional<String> token) {
        List<UpStock> all = new ArrayList<>();
        SourceStatus status = null;
        boolean complete = false;
        for (int page = 0; page < settings.maxPages(); page++) {
            UpstreamResponse<List<UpStock>> r = upstreams.get(Source.INVENTORY_SERVICE,
                "/api/v1/inventory?limit=100&offset=" + (page * 100), token, STOCK);
            status = r.sourceStatus();
            if (!r.ok()) {
                return new Listed<>(all, false, page == 0 ? status : degraded(status));
            }
            all.addAll(r.body());
            if (r.body().size() < 100) {
                complete = true;
                break;
            }
        }
        return new Listed<>(all, complete, status);
    }

    /** Probe whether asset-service accepts the console's token (it requires azp=asset-service; gap G-2). */
    public SourceStatus telemetryAccess(Optional<String> token) {
        UpstreamResponse<Object> r = upstreams.get(Source.ASSET_SERVICE, "/api/v1/alerts?status=ACTIVE&limit=1", token, ANY);
        SourceStatus s = r.sourceStatus();
        if (s.status() == SourceStatus.State.NOT_AUTHORIZED) {
            return SourceStatus.of(Source.ASSET_SERVICE, s.status(),
                "asset-service accepts only tokens issued to its own client (azp=asset-service), so it refuses the "
                    + "console's token. Use the telemetry console instead.", s.latencyMs());
        }
        return s;
    }

    public UpstreamResponse<UpInfo> info(Source source) {
        return upstreams.get(source, "/api/info", Optional.empty(), INFO);
    }

    /** The fulfillment request id for an order, per the configured link mode (decision D-008, gap G-1). */
    public Optional<String> fulfillmentRequestIdFor(String orderId) {
        if ("derived".equals(settings.fulfillmentLink()) && orderId.startsWith("ord_")) {
            return Optional.of("ful_" + orderId.substring("ord_".length()));
        }
        return Optional.empty();
    }

    private <T> Listed<T> pages(Source source, String first, Optional<String> token, TypeReference<List<T>> type) {
        List<T> all = new ArrayList<>();
        String next = first;
        String base = first.substring(0, first.indexOf('?'));
        SourceStatus status = null;
        for (int page = 0; page < settings.maxPages() && next != null; page++) {
            UpstreamResponse<List<T>> r = upstreams.get(source, next, token, type);
            status = r.sourceStatus();
            if (!r.ok()) {
                if (page == 0) {
                    return new Listed<>(List.of(), false, status);
                }
                return new Listed<>(all, false, degraded(status));
            }
            all.addAll(r.body());
            next = nextQuery(r).map(q -> base + "?" + q).orElse(null);
        }
        return new Listed<>(all, next == null, status);
    }

    /** Reuses only the query string of a Link rel=next, so an upstream can never redirect the console elsewhere. */
    static Optional<String> nextQuery(UpstreamResponse<?> response) {
        if (response.headers() == null) {
            return Optional.empty();
        }
        for (String link : response.headers().allValues("Link")) {
            Matcher m = NEXT.matcher(link);
            if (m.find()) {
                String target = m.group(1);
                int q = target.indexOf('?');
                if (q >= 0 && q < target.length() - 1) {
                    return Optional.of(target.substring(q + 1));
                }
            }
        }
        return Optional.empty();
    }

    private static SourceStatus degraded(SourceStatus failed) {
        return SourceStatus.of(failed.source(), SourceStatus.State.DEGRADED,
            "Only part of the list was read: " + failed.detail(), failed.latencyMs());
    }

    /** Ids are validated by pattern and URL-encoded before they become a path segment. */
    static String id(String value) {
        if (value == null || !SAFE_ID.matcher(value).matches()) {
            throw new IllegalArgumentException("invalid identifier");
        }
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
