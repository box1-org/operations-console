package org.box1.console.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

/** console.site-map entries (box1-docs#130): readable ones place a site; anything else is skipped, never fatal. */
class SiteMapTest {

    @Test
    void readsPlacesAndOptionalRegions() {
        SiteMap map = new SiteMap(List.of("site_ds9=22/48/West (site-west)", " site_spacedock=78.5/48 ", ""));
        assertEquals(new SiteMap.Location(22, 48, "West (site-west)"), map.locate("site_ds9").orElseThrow());
        assertEquals(new SiteMap.Location(78.5, 48, null), map.locate("site_spacedock").orElseThrow());
        assertTrue(map.locate("site_nyc").isEmpty());
    }

    @Test
    void skipsEntriesThatAreOutOfRangeOrMalformed() {
        SiteMap map = new SiteMap(List.of("site_a=101/5", "site_b=5", "nyc=5/5", "site_c=5/5/<b>", "site_d=-1/5", "site_e=0/100"));
        assertTrue(map.locate("site_a").isEmpty());
        assertTrue(map.locate("site_b").isEmpty());
        assertTrue(map.locate("site_c").isEmpty());
        assertTrue(map.locate("site_d").isEmpty());
        assertEquals(new SiteMap.Location(0, 100, null), map.locate("site_e").orElseThrow());
    }
}
