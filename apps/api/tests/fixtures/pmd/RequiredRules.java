import javax.crypto.spec.SecretKeySpec;

class RequiredRules {
    String broken(String value) {
        if (value == null && value.equals("")) {
            return value;
        }
        return "";
    }

    void emptyCatch() {
        try {
            Integer.parseInt("x");
        } catch (NumberFormatException exception) {
        }
    }

    boolean compare(String left, String right) {
        return left == right;
    }

    void unused() {
        int forgotten = 42;
    }

    void crypto() {
        new SecretKeySpec("hard-coded-secret".getBytes(), "AES");
    }

    void complex(boolean a, boolean b, boolean c, boolean d, boolean e) {
        if (a) {
            if (b) {
                if (c) {
                    if (d) {
                        if (e) {
                            System.out.println("deep");
                        }
                    }
                }
            }
        }
    }
}

class RequiredRulesTest {
    void testBehavior() {
        assert true;
    }
}
