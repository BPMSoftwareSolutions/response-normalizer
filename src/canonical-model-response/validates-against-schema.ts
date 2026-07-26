/**
 * A small, dependency-free JSON Schema evaluator.
 *
 * It supports exactly the keywords used by this capability's authority
 * documents: type, enum, const, required, properties, additionalProperties,
 * items, $ref (local), $defs, oneOf, allOf, if/then, minimum, minLength,
 * pattern, and format: date-time.
 *
 * The point is that the JSON authority in authority/ is the contract that is
 * actually enforced, rather than a document that drifts away from the code.
 */

export type SchemaViolation = Readonly<{
  path: string;
  message: string;
}>;

type JsonSchema = Record<string, unknown>;

export function validatesAgainstSchema(
  value: unknown,
  schema: JsonSchema
): readonly SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  evaluates(value, schema, schema, "$", violations);

  return Object.freeze(violations);
}

function evaluates(
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
  violations: SchemaViolation[]
): void {
  if (typeof schema.$ref === "string") {
    const resolved = resolvesReference(schema.$ref, root);

    if (resolved) {
      evaluates(value, resolved, root, path, violations);
    }

    return;
  }

  if (schema.const !== undefined && !isDeepEqual(value, schema.const)) {
    violations.push({
      path,
      message: `Expected the constant ${JSON.stringify(schema.const)}.`,
    });
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => isDeepEqual(value, candidate))) {
    violations.push({
      path,
      message: `Expected one of ${JSON.stringify(schema.enum)} but found ${JSON.stringify(value)}.`,
    });
  }

  if (schema.type !== undefined && !satisfiesType(value, schema.type)) {
    violations.push({
      path,
      message: `Expected type ${JSON.stringify(schema.type)} but found ${describesType(value)}.`,
    });

    // Further keywords assume the type held.
    return;
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      violations.push({ path, message: `Expected a minimum of ${schema.minimum}.` });
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      violations.push({
        path,
        message: `Expected at least ${schema.minLength} character(s).`,
      });
    }

    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      violations.push({
        path,
        message: `Expected a value matching /${schema.pattern}/.`,
      });
    }

    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
      violations.push({ path, message: "Expected an RFC 3339 date-time." });
    }
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    const itemSchema = schema.items as JsonSchema;

    value.forEach((entry, index) => {
      evaluates(entry, itemSchema, root, `${path}[${index}]`, violations);
    });
  }

  if (isPlainObject(value)) {
    evaluatesObject(value, schema, root, path, violations);
  }

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf as JsonSchema[]) {
      evaluates(value, branch, root, path, violations);
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = (schema.oneOf as JsonSchema[]).filter(
      (branch) => evaluatesQuietly(value, branch, root).length === 0
    );

    if (matches.length !== 1) {
      violations.push({
        path,
        message: `Expected exactly one matching schema branch but ${matches.length} matched.`,
      });
    }
  }

  if (schema.if !== undefined) {
    const conditionHeld =
      evaluatesQuietly(value, schema.if as JsonSchema, root).length === 0;

    if (conditionHeld && schema.then !== undefined) {
      evaluates(value, schema.then as JsonSchema, root, path, violations);
    }

    if (!conditionHeld && schema.else !== undefined) {
      evaluates(value, schema.else as JsonSchema, root, path, violations);
    }
  }
}

function evaluatesObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
  violations: SchemaViolation[]
): void {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;

  if (Array.isArray(schema.required)) {
    for (const key of schema.required as string[]) {
      if (!Object.hasOwn(value, key)) {
        violations.push({
          path: `${path}.${key}`,
          message: "Expected a required property.",
        });
      }
    }
  }

  if (schema.additionalProperties === false && schema.properties !== undefined) {
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) {
        violations.push({
          path: `${path}.${key}`,
          message: "Unexpected property. This contract is closed.",
        });
      }
    }
  }

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (Object.hasOwn(value, key)) {
      evaluates(value[key], propertySchema, root, `${path}.${key}`, violations);
    }
  }
}

function evaluatesQuietly(
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema
): readonly SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  evaluates(value, schema, root, "$", violations);

  return violations;
}

function resolvesReference(reference: string, root: JsonSchema): JsonSchema | null {
  if (!reference.startsWith("#/")) {
    return null;
  }

  let current: unknown = root;

  for (const rawSegment of reference.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");

    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
      return null;
    }

    current = current[segment];
  }

  return isPlainObject(current) ? (current as JsonSchema) : null;
}

function satisfiesType(value: unknown, type: unknown): boolean {
  const accepted = Array.isArray(type) ? type : [type];

  return accepted.some((candidate) => {
    switch (candidate) {
      case "object":
        return isPlainObject(value);
      case "array":
        return Array.isArray(value);
      case "string":
        return typeof value === "string";
      case "integer":
        return typeof value === "number" && Number.isInteger(value);
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "boolean":
        return typeof value === "boolean";
      case "null":
        return value === null;
      default:
        return false;
    }
  });
}

function describesType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((entry, index) => isDeepEqual(entry, right[index]))
    );
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();

    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index]) &&
      leftKeys.every((key) => isDeepEqual(left[key], right[key]))
    );
  }

  return false;
}
