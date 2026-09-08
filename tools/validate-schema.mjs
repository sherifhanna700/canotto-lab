// A small JSON Schema validator.
//
// Enough of draft 2020-12 to check that what the app writes matches what the
// published schemas promise: types, required properties, enums, constants,
// bounds, array items, allOf and oneOf composition, and $ref between files
// including pointers into another file's $defs. Not a general validator, and
// it does not try to be. It exists so the schemas cannot quietly drift away
// from the data.

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
};

/**
 * Resolve a $ref, following a JSON pointer into a file's $defs.
 * A bare "#/$defs/x" resolves against the document currently being followed,
 * which is why the base travels with the recursion.
 */
function resolve(ref, registry, base) {
  const [id, pointer] = ref.split('#');
  const root = id ? registry[id] : registry[base];
  if (!root) return null;
  if (!pointer) return { schema: root, base: id || base };
  let node = root;
  for (const rawPart of pointer.split('/').slice(1)) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    node = node?.[part];
    if (node === undefined) return null;
  }
  return { schema: node, base: id || base };
}

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
export function validate(data, schema, registry = {}, path = '$', base = '') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.$ref) {
    const target = resolve(schema.$ref, registry, base);
    if (!target) return [`${path}: cannot resolve ${schema.$ref}`];
    return validate(data, target.schema, registry, path, target.base);
  }

  // allOf is how a document schema composes the shared envelope with its own
  // payload, so it has to be understood or nothing validates.
  for (const sub of schema.allOf || []) errors.push(...validate(data, sub, registry, path, base));

  if (schema.oneOf) {
    const branches = schema.oneOf.map((sub) => validate(data, sub, registry, path, base));
    if (!branches.some((b) => b.length === 0)) {
      errors.push(`${path}: matches none of the ${schema.oneOf.length} allowed forms`);
    }
  }

  if (schema.const !== undefined && data !== schema.const) {
    errors.push(`${path}: expected the constant ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`);
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
    if (schema.items) data.forEach((v, i) => errors.push(...validate(v, schema.items, registry, `${path}[${i}]`, base)));
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of schema.required || []) {
      if (data[key] === undefined) errors.push(`${path}: missing required property "${key}"`);
    }
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (data[key] !== undefined) errors.push(...validate(data[key], sub, registry, `${path}.${key}`, base));
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
