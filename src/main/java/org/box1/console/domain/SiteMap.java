package org.box1.console.domain;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

/**
 * Fixed places of sites on the Sites page map (box1-docs#130), from {@code console.site-map}. The map is a
 * self-contained drawing, not geography: x and y are 0 to 100 (percent of its width and height from the top left).
 * An entry that cannot be read is skipped with a warning, so a typo moves one site off the map instead of failing
 * the page.
 */
@ApplicationScoped
public class SiteMap {
    private static final Logger LOG = Logger.getLogger(SiteMap.class);
    private static final Pattern ENTRY = Pattern.compile(
        "^(site_[A-Za-z0-9_-]{1,64})=(\\d{1,3}(?:\\.\\d+)?)/(\\d{1,3}(?:\\.\\d+)?)(?:/([A-Za-z0-9 ._()-]{1,40}))?$");

    /** A site's place on the map; {@code region} is a short label such as "West", or null. */
    public record Location(double x, double y, String region) {
    }

    private final Map<String, Location> locations;

    @Inject
    public SiteMap(ConsoleReads.Settings settings) {
        this(settings.siteMap());
    }

    SiteMap(List<String> entries) {
        this.locations = Collections.unmodifiableMap(parse(entries));
    }

    public Optional<Location> locate(String siteId) {
        return Optional.ofNullable(locations.get(siteId));
    }

    static Map<String, Location> parse(List<String> entries) {
        Map<String, Location> parsed = new LinkedHashMap<>();
        for (String raw : entries == null ? List.<String>of() : entries) {
            String entry = raw == null ? "" : raw.strip();
            if (entry.isEmpty()) {
                continue;
            }
            Matcher m = ENTRY.matcher(entry);
            double x = m.matches() ? Double.parseDouble(m.group(2)) : -1;
            double y = m.matches() ? Double.parseDouble(m.group(3)) : -1;
            if (x < 0 || x > 100 || y < 0 || y > 100) {
                // The value is configuration, not a secret, but only its position in the list is logged.
                LOG.warnf("console.site-map entry %d is not siteId=x/y[/region] with x and y from 0 to 100; skipped",
                    entries.indexOf(raw) + 1);
                continue;
            }
            String region = m.group(4) == null ? null : m.group(4).strip();
            parsed.put(m.group(1), new Location(x, y, region));
        }
        return parsed;
    }
}
