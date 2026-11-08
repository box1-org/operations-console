package org.box1.console;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;

/** Operations declared in the console's versioned contract, META-INF/openapi.yaml. */
final class Contract {
    record Op(String method, String path, String operationId) {
        /** The path with example ids filled in. */
        String concrete() {
            return path.replace("{orderId}", "ord_test1").replace("{incidentId}", "inc_ord_test1")
                .replace("{name}", "inventory-contention").replace("{scenarioRunId}", "scn_0123456789abcdef0123")
                .replace("{analysisId}", "ana_0123456789abcdef0123456789abcdef")
                .replace("{conversationId}", "conv_0123456789abcdef0123456789abcdef");
        }
    }

    private Contract() {
    }

    static JsonNode document() {
        try (InputStream in = Contract.class.getResourceAsStream("/META-INF/openapi.yaml")) {
            // Strict: a duplicated key is an error here, as it is for the front end's type generator.
            return new ObjectMapper(new YAMLFactory()).enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
                .readTree(in);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    static List<Op> operations() {
        List<Op> ops = new ArrayList<>();
        document().get("paths").properties().forEach(path -> path.getValue().properties().forEach(op ->
            ops.add(new Op(op.getKey().toUpperCase(Locale.ROOT), path.getKey(), op.getValue().get("operationId").asText()))));
        return ops;
    }
}
