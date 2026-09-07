// A small JSON Schema validator.
//
// Enough of draft 2020-12 to check that what the app writes matches what the
// published schemas promise: types, required properties, enums, bounds, array
// items, and $ref between the schema files. Not a general validator, and it
// does not try to be. It exists so the schemas cannot quietly drift away from
// the data.

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
};

const matchesType = (value, type) => {
  const want = Array.isArray(type) ? type : [type];
  const got = typeOf(value);
  return want.some((t) => t === got || (t === 'number' && got === 'integer'));
};

/**
 * @param data      the value to check
 * @param schema    a schema object
 * @param registry  { [$id]: schema } so $ref can be resolved
 * @returns array of human-readable problems, empty when valid
 */
export function validate(data, schema, registry = {}, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.$ref) {
    const target = registry[schema.$ref];
    if (!target) return [`${path}: cannot resolve ${schema.$ref}`];
    return validate(data, target, registry, path);
  }

  if (schema.type && !matchesType(data, schema.type)) {
    return [`${path}: expected ${JSON.stringify(schema.type)}, got ${typeOf(data)}`];
  }
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${path}: ${JSON.stringify(data)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) errors.push(`${path}: ${data} is below the minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && data > schema.maximum) errors.push(`${path}: ${data} is above the maximum ${schema.maximum}`);
  }
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && data.length > schema.maxItems) errors.push(`${path}: allows at most ${schema.maxItems} items`);
    if (schema.items) data.forEach((v, i) => errors.push(...validate(v, schema.items, registry, `${path}[${i}]`)));
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of schema.required || []) {
      if (data[key] === undefined) errors.push(`${path}: missing required property "${key}"`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (data[key] !== undefined) errors.push(...validate(data[key], sub, registry, `${path}.${key}`));
    }
  }
  return errors;
}

/** Load every schema in a directory into a registry keyed by $id. */
export async function loadSchemas(dir) {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const registry = {};
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const schema = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    registry[schema.$id] = schema;
    registry[name] = schema;
  }
  return registry;
}
