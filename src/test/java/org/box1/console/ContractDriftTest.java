package org.box1.console;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.lang.reflect.Method;
import java.util.Set;
import java.util.TreeSet;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import org.box1.console.api.ConsoleResource;
import org.junit.jupiter.api.Test;

/** The console API implementation and META-INF/openapi.yaml declare exactly the same operations (decision D-006). */
class ContractDriftTest {

    @Test
    void implementationMatchesTheVersionedContract() {
        String base = ConsoleResource.class.getAnnotation(Path.class).value();
        Set<String> implemented = new TreeSet<>();
        for (Method m : ConsoleResource.class.getDeclaredMethods()) {
            String verb = m.isAnnotationPresent(GET.class) ? "GET" : m.isAnnotationPresent(POST.class) ? "POST" : null;
            if (verb != null) {
                Path p = m.getAnnotation(Path.class);
                implemented.add(verb + " " + base + (p == null ? "" : p.value()));
            }
        }
        Set<String> declared = new TreeSet<>();
        Contract.operations().forEach(op -> declared.add(op.method() + " " + op.path()));
        assertEquals(declared, implemented);
    }
}
