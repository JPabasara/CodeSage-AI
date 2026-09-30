export type PmdRuleGuidance = {
  impact: string
  recommendation: string
  documentationUrl: string
}

type Category =
  "bestpractices" | "design" | "errorprone" | "multithreading" | "security"
type Entry = readonly [Category, string, string]

const GUIDANCE: Record<string, Entry> = {
  AvoidPrintStackTrace: [
    "bestpractices",
    "Direct stack-trace printing bypasses configured logging and may expose internals or lose operational context.",
    "Log the exception with context through the project logger, or propagate it to code that can handle it.",
  ],
  AvoidUsingHardCodedIP: [
    "bestpractices",
    "A literal IP couples code to one environment and makes deployment, failover, and network changes harder.",
    "Use validated configuration or service discovery, and prefer a hostname when appropriate.",
  ],
  DoubleBraceInitialization: [
    "bestpractices",
    "This creates an anonymous class, may retain its enclosing instance, and complicates serialization and equality.",
    "Initialize normally, or use a suitable factory such as List.of or Map.of.",
  ],
  NonExhaustiveSwitch: [
    "bestpractices",
    "Unhandled values can silently do nothing, especially after an enum gains a new constant.",
    "Handle all expected cases and deliberately cover the remainder with an exhaustive expression or default branch.",
  ],
  PreserveStackTrace: [
    "bestpractices",
    "Replacing an exception without its cause hides the original failure location.",
    "Pass the caught exception as the cause, or rethrow it unchanged.",
  ],
  UnusedAssignment: [
    "bestpractices",
    "The assigned value is overwritten or discarded before use, often indicating dead code or a mistake.",
    "Remove the assignment or correct the flow so the intended value is consumed.",
  ],
  UnusedLocalVariable: [
    "bestpractices",
    "The unused local adds noise and may reveal incomplete logic or an ignored result.",
    "Remove it and any side-effect-free initializer, or use the value where intended.",
  ],
  UnusedPrivateField: [
    "bestpractices",
    "The unread field increases class state and maintenance cost without affecting behavior.",
    "Remove the field and its writes, or connect it to the intended behavior.",
  ],
  UnusedPrivateMethod: [
    "bestpractices",
    "The uncalled method is unreachable code that can mislead maintainers.",
    "Delete it, or call it from the intended path if this is a wiring defect.",
  ],
  ExceptionAsFlowControl: [
    "design",
    "Exceptions used for expected branching obscure normal flow and add avoidable overhead.",
    "Test the expected condition directly and reserve exceptions for exceptional states.",
  ],
  UselessOverridingMethod: [
    "design",
    "An override that only delegates unchanged arguments adds no behavior and obscures the inheritance chain.",
    "Remove it unless annotations, visibility, documentation, or an extension point require it.",
  ],
  AssignmentInOperand: [
    "errorprone",
    "Assignment inside an expression is easy to mistake for comparison and hides a state change.",
    "Move the assignment to its own statement before using the value.",
  ],
  AvoidDecimalLiteralsInBigDecimalConstructor: [
    "errorprone",
    "A decimal double carries a binary approximation into BigDecimal instead of the decimal shown in source.",
    "Use a string constructor or BigDecimal.valueOf.",
  ],
  BrokenNullCheck: [
    "errorprone",
    "The expression can dereference the value precisely when it is null.",
    "Fix the operators and ordering so dereferencing follows a successful non-null check.",
  ],
  DoNotThrowExceptionInFinally: [
    "errorprone",
    "A failure thrown from finally can hide the exception that originally triggered cleanup.",
    "Use try-with-resources or preserve secondary cleanup failures without replacing the original.",
  ],
  EmptyCatchBlock: [
    "errorprone",
    "Swallowing an exception hides failure and may continue with invalid state.",
    "Handle, log, or rethrow it; narrowly document any intentional suppression.",
  ],
  EqualsNull: [
    "errorprone",
    "Calling equals with null is nearly always false and usually reflects a mistaken null check.",
    "Use == null or != null.",
  ],
  IdenticalConditionalBranches: [
    "errorprone",
    "Equivalent branches make the condition meaningless and may indicate a copy-paste error.",
    "Combine them or correct the branch with missing behavior.",
  ],
  ImplicitSwitchFallThrough: [
    "errorprone",
    "Unmarked fall-through can execute the next case accidentally.",
    "Add break, return, or throw, or clearly mark intentional fall-through.",
  ],
  JumbledIncrementer: [
    "errorprone",
    "Updating the wrong loop variable can produce incorrect results or an infinite loop.",
    "Update the controlling variable and move unrelated mutations into the body.",
  ],
  MisplacedNullCheck: [
    "errorprone",
    "The value is dereferenced before its null check, making the guard ineffective.",
    "Check for null before every dereference or establish a non-null invariant earlier.",
  ],
  OverrideBothEqualsAndHashcode: [
    "errorprone",
    "Overriding only one method breaks their contract in hash-based collections.",
    "Implement both from the same significant fields, or inherit both.",
  ],
  ReturnFromFinallyBlock: [
    "errorprone",
    "Returning from finally suppresses exceptions and overrides earlier return values.",
    "Remove the return from finally and return after cleanup.",
  ],
  UnconditionalIfStatement: [
    "errorprone",
    "An always-true or always-false condition leaves unreachable or misleading code.",
    "Remove the condition or correct it to depend on intended runtime state.",
  ],
  UnusedNullCheckInEquals: [
    "errorprone",
    "The null check is redundant or ineffective and may conceal faulty equality logic.",
    "Simplify the expression and use Objects.equals when appropriate.",
  ],
  UseEqualsToCompareStrings: [
    "errorprone",
    "Reference comparison checks object identity, not String content.",
    "Use equals or Objects.equals and handle nullability explicitly.",
  ],
  UseLocaleWithCaseConversions: [
    "errorprone",
    "Default-locale case conversion can produce different keys or identifiers on different machines.",
    "Use Locale.ROOT for locale-independent values or an explicit user locale for natural language.",
  ],
  DontCallThreadRun: [
    "multithreading",
    "Calling run executes synchronously and does not start a new thread.",
    "Call start, or submit the task to an ExecutorService.",
  ],
  DoubleCheckedLocking: [
    "multithreading",
    "An incorrect pattern can expose stale or partially initialized state.",
    "Prefer a holder or enum singleton, or satisfy the Java memory model with correct volatile and locking use.",
  ],
  UseNotifyAllInsteadOfNotify: [
    "multithreading",
    "notify may wake an ineligible waiter while one that can proceed remains blocked.",
    "Use notifyAll with condition loops, or higher-level concurrency primitives.",
  ],
  ArrayIsStoredDirectly: [
    "bestpractices",
    "Keeping a caller-owned array allows later external mutation of internal state.",
    "Store a defensive copy or an immutable representation.",
  ],
  AvoidMessageDigestField: [
    "bestpractices",
    "MessageDigest is mutable and not thread-safe, so shared use can corrupt results.",
    "Create one per operation or confine each instance to one thread.",
  ],
  CheckResultSet: [
    "bestpractices",
    "Reading before next succeeds accesses an invalid cursor when no row was returned.",
    "Check next before reading columns and handle an empty result.",
  ],
  MethodReturnsInternalArray: [
    "bestpractices",
    "Returning an internal array lets callers mutate private state.",
    "Return a defensive copy or immutable view.",
  ],
  RelianceOnDefaultCharset: [
    "bestpractices",
    "The default charset varies by machine, causing environment-dependent encoding behavior.",
    "Pass an explicit charset such as StandardCharsets.UTF_8.",
  ],
  UseTryWithResources: [
    "bestpractices",
    "Manual resource cleanup is easy to skip on exceptions and can leak handles.",
    "Declare AutoCloseable values in try-with-resources.",
  ],
  AssignmentToNonFinalStatic: [
    "errorprone",
    "Mutable global state creates hidden coupling, races, and order-dependent behavior.",
    "Make constants final; otherwise encapsulate and synchronize mutation or use owned instance state.",
  ],
  ClassCastExceptionWithToArray: [
    "errorprone",
    "Casting Object[] from toArray to a specific array type fails at runtime.",
    "Use a typed overload such as toArray(String[]::new).",
  ],
  CloseResource: [
    "errorprone",
    "A resource may escape without being closed, leaking files, sockets, or database handles.",
    "Use try-with-resources or transfer ownership explicitly.",
  ],
  CollectionTypeMismatch: [
    "errorprone",
    "An incompatible lookup or removal value cannot match and likely signals a type mistake.",
    "Use a value compatible with the collection element or key type.",
  ],
  ComparisonWithNaN: [
    "errorprone",
    "NaN is unequal to every value, including itself, so equality never detects it.",
    "Use Double.isNaN or Float.isNaN.",
  ],
  ConstructorCallsOverridableMethod: [
    "errorprone",
    "Dispatch into a subclass can occur before subclass fields are initialized.",
    "Call a private or final helper, or defer overridable behavior until construction finishes.",
  ],
  InvalidLogMessageFormat: [
    "errorprone",
    "Mismatched templates and arguments can omit values, misformat output, or mishandle exceptions.",
    "Match placeholders to arguments and use the logging API's throwable form.",
  ],
  ReturnEmptyCollectionRatherThanNull: [
    "errorprone",
    "Null collections burden every caller and increase NullPointerException risk.",
    "Return an empty collection of the declared type.",
  ],
  UnusedReturnValue: [
    "errorprone",
    "Ignoring a return value may discard an immutable operation's result or an important status.",
    "Use or assign the result, or explicitly justify why ignoring it is safe.",
  ],
  UseCorrectExceptionLogging: [
    "errorprone",
    "Logging only the message loses the exception type and stack trace.",
    "Pass the exception object to the logger's throwable overload.",
  ],
  UnsupportedJdkApiUsage: [
    "errorprone",
    "The API is unavailable in the target JDK and can fail to compile or run there.",
    "Use a compatible API or deliberately raise the supported runtime version.",
  ],
  NonThreadSafeSingleton: [
    "multithreading",
    "Unsafe lazy initialization can create multiple instances or publish incomplete state.",
    "Use an enum, initialization-on-demand holder, or correct synchronization.",
  ],
  UnsynchronizedStaticFormatter: [
    "multithreading",
    "A shared legacy formatter is mutable and can corrupt results under concurrency.",
    "Use immutable java.time formatters, per-call instances, or synchronization.",
  ],
  CognitiveComplexity: [
    "design",
    "Nested and interrupted control flow makes the code difficult to understand and change safely.",
    "Use guard clauses and extract cohesive decisions into named methods.",
  ],
  ExcessiveParameterList: [
    "design",
    "Many parameters make calls unclear and often signal too many responsibilities.",
    "Group related values, split responsibilities, or derive values from a collaborator.",
  ],
  GodClass: [
    "design",
    "One class owns too much data and behavior, increasing coupling and change risk.",
    "Extract cohesive responsibilities into focused classes with narrow interfaces.",
  ],
  NPathComplexity: [
    "design",
    "Many execution paths make reasoning and adequate testing disproportionately difficult.",
    "Simplify boolean logic, use early exits, and extract independent branches.",
  ],
  AssertStatementInTest: [
    "bestpractices",
    "Java assertions may be disabled, allowing a test to pass without checking its result.",
    "Use the test framework's assertion API.",
  ],
  UnitTestShouldIncludeAssert: [
    "bestpractices",
    "A test without verification may execute code while allowing regressions to pass.",
    "Assert the result or interaction, or use an explicit exception assertion.",
  ],
  JUnitJupiterTestNoPrivateModifier: [
    "errorprone",
    "A private JUnit Jupiter test cannot be discovered as an ordinary test.",
    "Remove private; package-private visibility is normally sufficient.",
  ],
  WrongTestAnnotation: [
    "errorprone",
    "An incompatible annotation can cause the test to be skipped or behave unexpectedly.",
    "Use the annotation and signature required by the active JUnit version.",
  ],
  TestClassWithoutTestCases: [
    "errorprone",
    "The apparent test class has no discoverable tests, so intended coverage may never run.",
    "Add correctly annotated tests, fix discovery, or rename/remove a non-test class.",
  ],
  HardCodedCryptoKey: [
    "security",
    "A key in source is exposed to repository readers and cannot be safely rotated after disclosure.",
    "Load it from a managed secret store or protected runtime configuration and support rotation.",
  ],
  InsecureCryptoIv: [
    "security",
    "A fixed, predictable, or reused IV can reveal patterns and break the encryption mode's guarantees.",
    "Generate a fresh secure IV of the required size per encryption and store it with the ciphertext.",
  ],
}

export function getPmdRuleGuidance(
  ruleId: string | null | undefined,
): PmdRuleGuidance | undefined {
  if (!ruleId?.startsWith("pmd:")) return undefined
  const ruleName = ruleId.slice(4)
  const entry = GUIDANCE[ruleName]
  if (!entry) return undefined
  const [category, impact, recommendation] = entry
  return {
    impact,
    recommendation,
    documentationUrl: `https://docs.pmd-code.org/pmd-doc-7.27.0/pmd_rules_java_${category}.html#${ruleName.toLowerCase()}`,
  }
}

export const PMD_GUIDANCE_RULES = Object.freeze(Object.keys(GUIDANCE))
