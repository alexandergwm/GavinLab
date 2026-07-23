const definitions = new Map();

export function registerPageDefinition(definition) {
  const id = definition?.id;
  if (!id || definitions.has(id)) {
    throw new Error(`Invalid or duplicate page definition: ${id || 'unknown'}`);
  }
  definitions.set(id, Object.freeze({
    transitionProperty: 'opacity',
    ...definition,
  }));
}

export function getPageDefinition(id) {
  return definitions.get(id) || null;
}

export function listPageDefinitions() {
  return [...definitions.values()];
}

export function listPageIds() {
  return [...definitions.keys()];
}

registerPageDefinition({
  id: 'home',
  transitionProperty: 'transform',
});

registerPageDefinition({
  id: 'apps',
  style: 'apps',
  feature: 'apps',
  prewarm: true,
  transitionProperty: 'opacity',
});
