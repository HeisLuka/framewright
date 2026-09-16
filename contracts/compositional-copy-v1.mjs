import { sha256Canonical } from './factory-identity-v1.mjs';
import {
  PROPOSAL_SCHEMA,
  computeContextHash,
  computeProposalId,
  validateContextPack,
  validateCreativeProposal,
  compileCreativeProposal,
} from './creative-proposal-v1.mjs';

export const COPY_LANGUAGE_SCHEMA = 'newboo-copy-language-v1';
export const COMPOSED_PROPOSAL_SCHEMA = 'newboo-composed-creative-proposal-v1';
export const COPY_PROGRAM_SCHEMA = 'newboo-copy-program-v1';
export const COMPOSED_PROGRAM_SCHEMA = 'newboo-accepted-composed-creative-program-v1';
export const COPY_ROLES = ['hook', 'tension', 'payoff'];
export const SURFACE_TYPES = ['sentence', 'clause', 'fragment', 'question_body', 'noun_phrase'];

const FORBIDDEN_PROPOSAL_KEYS = new Set([
  'text', 'copy', 'raw_text', 'prompt', 'url', 'uri', 'path', 'file', 'filename', 'html', 'script',
]);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function add(errors, code, path, message) {
  errors.push({ code, path, message });
}

function sortedErrors(errors) {
  return errors.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

function checkUnknownKeys(errors, value, allowed, path, { forbidRaw = false } = {}) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value).sort()) {
    if (allowed.has(key)) continue;
    const childPath = `${path}/${key}`;
    if (forbidRaw && FORBIDDEN_PROPOSAL_KEYS.has(key.toLowerCase())) {
      add(errors, 'FORBIDDEN_RAW_CONTENT', childPath, `proposal may not carry raw ${key}; reference server-owned IDs instead`);
    } else {
      add(errors, 'UNKNOWN_FIELD', childPath, `unknown field ${key}`);
    }
  }
}

function requireString(errors, value, path, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) add(errors, 'INVALID_STRING', path, allowEmpty ? 'expected a string' : 'expected a non-empty string');
}

function requireInteger(errors, value, path, { min = Number.MIN_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min) add(errors, 'INVALID_INTEGER', path, `expected an integer >= ${min}`);
}

function requireBoolean(errors, value, path) {
  if (typeof value !== 'boolean') add(errors, 'INVALID_BOOLEAN', path, 'expected a boolean');
}

function requireStringArray(errors, value, path, { minItems = 0 } = {}) {
  if (!Array.isArray(value)) {
    add(errors, 'INVALID_ARRAY', path, 'expected an array');
    return [];
  }
  if (value.length < minItems) add(errors, 'ARRAY_TOO_SHORT', path, `expected at least ${minItems} item(s)`);
  value.forEach((item, index) => requireString(errors, item, `${path}/${index}`));
  return value;
}

function duplicateValues(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes].sort();
}

function requireUnique(errors, values, path) {
  for (const duplicate of duplicateValues(values)) add(errors, 'DUPLICATE_REFERENCE', path, `duplicate value ${duplicate}`);
}

function contextIndexes(pack) {
  const books = new Map();
  const facts = new Map();
  for (const book of pack.books || []) {
    const factMap = new Map((book.facts || []).map((fact) => [fact.fact_id, fact]));
    books.set(book.book_id, { book, facts: factMap });
    for (const fact of book.facts || []) facts.set(fact.fact_id, { fact, book_id: book.book_id });
  }
  return { books, facts };
}

function copyLanguageIdentityInput(language) {
  const { copy_language_hash: _hash, ...rest } = language || {};
  return rest;
}

export function computeCopyLanguageHash(language) {
  return sha256Canonical(copyLanguageIdentityInput(language));
}

function normalizedExpression(expression) {
  if (!isObject(expression)) return expression;
  return {
    ...expression,
    ...(Array.isArray(expression.bindings)
      ? { bindings: [...expression.bindings].map((x) => ({ ...x })).sort((a, b) => String(a.slot_id).localeCompare(String(b.slot_id)) || String(a.form_id).localeCompare(String(b.form_id))) }
      : {}),
  };
}

function composedProposalIdentityInput(proposal) {
  const { proposal_id: _proposalId, ...rest } = proposal || {};
  const out = structuredClone(rest);
  if (isObject(out.narrative)) {
    if (out.narrative.hook) out.narrative.hook = normalizedExpression(out.narrative.hook);
    if (out.narrative.tension) out.narrative.tension = normalizedExpression(out.narrative.tension);
    if (out.narrative.payoff) out.narrative.payoff = normalizedExpression(out.narrative.payoff);
  }
  if (Array.isArray(out.selected_asset_ids)) out.selected_asset_ids = [...out.selected_asset_ids].sort();
  return out;
}

export function computeComposedProposalId(proposal) {
  return `nbcp1_${sha256Canonical(composedProposalIdentityInput(proposal))}`;
}

function copyProgramIdentityInput(program) {
  const { copy_program_id: _id, ...rest } = program || {};
  return rest;
}

export function computeCopyProgramId(program) {
  return `nbcopy1_${sha256Canonical(copyProgramIdentityInput(program))}`;
}

function composedProgramIdentityInput(program) {
  const { program_id: _id, ...rest } = program || {};
  return rest;
}

export function computeComposedProgramId(program) {
  return `nbcprog1_${sha256Canonical(composedProgramIdentityInput(program))}`;
}

function languageIndexes(language) {
  const books = new Map();
  const forms = new Map();
  const templates = new Map();
  for (const book of language.books || []) {
    const formMap = new Map();
    const templateMap = new Map();
    for (const form of book.surface_forms || []) {
      formMap.set(form.form_id, form);
      forms.set(form.form_id, { form, book_id: book.book_id });
    }
    for (const template of book.templates || []) {
      templateMap.set(template.template_id, template);
      templates.set(template.template_id, { template, book_id: book.book_id });
    }
    books.set(book.book_id, { book, forms: formMap, templates: templateMap });
  }
  return { books, forms, templates };
}

export function validateCopyLanguage(pack, language) {
  const contextReport = validateContextPack(pack);
  if (!contextReport.valid) return { valid: false, code: 'INVALID_SERVER_CONTEXT', errors: contextReport.errors };

  const errors = [];
  if (!isObject(language)) {
    add(errors, 'TYPE_OBJECT_REQUIRED', '', 'CopyLanguage must be an object');
    return { valid: false, code: 'INVALID_SERVER_COPY_LANGUAGE', errors };
  }

  checkUnknownKeys(errors, language, new Set(['schema', 'copy_language_id', 'copy_language_hash', 'context_pack_id', 'context_hash', 'locale', 'books']), '');
  if (language.schema !== COPY_LANGUAGE_SCHEMA) add(errors, 'SCHEMA_VERSION_MISMATCH', '/schema', `expected ${COPY_LANGUAGE_SCHEMA}`);
  requireString(errors, language.copy_language_id, '/copy_language_id');
  requireString(errors, language.copy_language_hash, '/copy_language_hash');
  requireString(errors, language.context_pack_id, '/context_pack_id');
  requireString(errors, language.context_hash, '/context_hash');
  requireString(errors, language.locale, '/locale');
  if (language.context_pack_id !== pack.context_pack_id) add(errors, 'CONTEXT_ID_MISMATCH', '/context_pack_id', `expected ${pack.context_pack_id}`);
  if (language.context_hash !== pack.context_hash) add(errors, 'CONTEXT_HASH_MISMATCH', '/context_hash', `expected ${pack.context_hash}`);

  const ctx = contextIndexes(pack);
  if (!Array.isArray(language.books) || language.books.length === 0) add(errors, 'INVALID_ARRAY', '/books', 'books must be a non-empty array');
  const bookIds = [];
  const globalFormIds = new Set();
  const globalTemplateIds = new Set();

  for (let bi = 0; bi < (Array.isArray(language.books) ? language.books.length : 0); bi += 1) {
    const bookLanguage = language.books[bi];
    const bp = `/books/${bi}`;
    if (!isObject(bookLanguage)) { add(errors, 'TYPE_OBJECT_REQUIRED', bp, 'book language must be an object'); continue; }
    checkUnknownKeys(errors, bookLanguage, new Set(['book_id', 'surface_forms', 'templates']), bp);
    requireString(errors, bookLanguage.book_id, `${bp}/book_id`);
    if (typeof bookLanguage.book_id === 'string') bookIds.push(bookLanguage.book_id);
    const contextBook = ctx.books.get(bookLanguage.book_id);
    if (!contextBook) add(errors, 'UNKNOWN_BOOK', `${bp}/book_id`, `book ${bookLanguage.book_id} is not in ContextPack`);

    if (!Array.isArray(bookLanguage.surface_forms) || bookLanguage.surface_forms.length === 0) add(errors, 'INVALID_ARRAY', `${bp}/surface_forms`, 'surface_forms must be a non-empty array');
    for (let fi = 0; fi < (Array.isArray(bookLanguage.surface_forms) ? bookLanguage.surface_forms.length : 0); fi += 1) {
      const form = bookLanguage.surface_forms[fi];
      const fp = `${bp}/surface_forms/${fi}`;
      if (!isObject(form)) { add(errors, 'TYPE_OBJECT_REQUIRED', fp, 'surface form must be an object'); continue; }
      checkUnknownKeys(errors, form, new Set(['form_id', 'fact_id', 'surface_type', 'text', 'spoiler_level', 'composition_groups']), fp);
      requireString(errors, form.form_id, `${fp}/form_id`);
      requireString(errors, form.fact_id, `${fp}/fact_id`);
      requireString(errors, form.surface_type, `${fp}/surface_type`);
      if (!SURFACE_TYPES.includes(form.surface_type)) add(errors, 'SURFACE_TYPE_INVALID', `${fp}/surface_type`, `unsupported surface type ${form.surface_type}`);
      requireString(errors, form.text, `${fp}/text`);
      requireInteger(errors, form.spoiler_level, `${fp}/spoiler_level`, { min: 0 });
      const groups = requireStringArray(errors, form.composition_groups, `${fp}/composition_groups`);
      requireUnique(errors, groups, `${fp}/composition_groups`);
      if (contextBook && typeof form.fact_id === 'string' && !contextBook.facts.has(form.fact_id)) add(errors, 'UNKNOWN_FACT', `${fp}/fact_id`, `unknown fact ${form.fact_id} for book ${bookLanguage.book_id}`);
      if (typeof form.form_id === 'string') {
        if (globalFormIds.has(form.form_id)) add(errors, 'DUPLICATE_ID', `${fp}/form_id`, `duplicate form_id ${form.form_id}`);
        globalFormIds.add(form.form_id);
      }
    }

    if (!Array.isArray(bookLanguage.templates) || bookLanguage.templates.length === 0) add(errors, 'INVALID_ARRAY', `${bp}/templates`, 'templates must be a non-empty array');
    for (let ti = 0; ti < (Array.isArray(bookLanguage.templates) ? bookLanguage.templates.length : 0); ti += 1) {
      const template = bookLanguage.templates[ti];
      const tp = `${bp}/templates/${ti}`;
      if (!isObject(template)) { add(errors, 'TYPE_OBJECT_REQUIRED', tp, 'template must be an object'); continue; }
      checkUnknownKeys(errors, template, new Set(['template_id', 'role', 'angle_types', 'parts', 'require_shared_group', 'allow_fact_reuse', 'max_output_chars']), tp);
      requireString(errors, template.template_id, `${tp}/template_id`);
      if (!COPY_ROLES.includes(template.role)) add(errors, 'COPY_ROLE_INVALID', `${tp}/role`, `role must be one of ${COPY_ROLES.join(',')}`);
      const angleTypes = requireStringArray(errors, template.angle_types, `${tp}/angle_types`, { minItems: 1 });
      requireUnique(errors, angleTypes, `${tp}/angle_types`);
      for (let ai = 0; ai < angleTypes.length; ai += 1) if (!pack.capabilities.angle_types.includes(angleTypes[ai])) add(errors, 'CAPABILITY_DENIED', `${tp}/angle_types/${ai}`, `angle ${angleTypes[ai]} is not exposed by ContextPack`);
      requireBoolean(errors, template.require_shared_group, `${tp}/require_shared_group`);
      requireBoolean(errors, template.allow_fact_reuse, `${tp}/allow_fact_reuse`);
      requireInteger(errors, template.max_output_chars, `${tp}/max_output_chars`, { min: 1 });
      if (!Array.isArray(template.parts) || template.parts.length === 0) add(errors, 'INVALID_ARRAY', `${tp}/parts`, 'parts must be a non-empty array');
      const slotIds = [];
      for (let pi = 0; pi < (Array.isArray(template.parts) ? template.parts.length : 0); pi += 1) {
        const part = template.parts[pi];
        const pp = `${tp}/parts/${pi}`;
        if (!isObject(part)) { add(errors, 'TYPE_OBJECT_REQUIRED', pp, 'template part must be an object'); continue; }
        if (part.kind === 'literal') {
          checkUnknownKeys(errors, part, new Set(['kind', 'text']), pp);
          requireString(errors, part.text, `${pp}/text`, { allowEmpty: true });
        } else if (part.kind === 'slot') {
          checkUnknownKeys(errors, part, new Set(['kind', 'slot_id', 'fact_kinds', 'surface_types']), pp);
          requireString(errors, part.slot_id, `${pp}/slot_id`);
          if (typeof part.slot_id === 'string') slotIds.push(part.slot_id);
          const factKinds = requireStringArray(errors, part.fact_kinds, `${pp}/fact_kinds`, { minItems: 1 }); requireUnique(errors, factKinds, `${pp}/fact_kinds`);
          const surfaceTypes = requireStringArray(errors, part.surface_types, `${pp}/surface_types`, { minItems: 1 }); requireUnique(errors, surfaceTypes, `${pp}/surface_types`);
          for (let si = 0; si < surfaceTypes.length; si += 1) if (!SURFACE_TYPES.includes(surfaceTypes[si])) add(errors, 'SURFACE_TYPE_INVALID', `${pp}/surface_types/${si}`, `unsupported surface type ${surfaceTypes[si]}`);
        } else {
          add(errors, 'TEMPLATE_PART_KIND_INVALID', `${pp}/kind`, `unsupported template part kind ${part.kind}`);
        }
      }
      if (slotIds.length === 0) add(errors, 'TEMPLATE_SLOT_REQUIRED', `${tp}/parts`, 'template must contain at least one slot');
      requireUnique(errors, slotIds, `${tp}/parts`);
      if (typeof template.template_id === 'string') {
        if (globalTemplateIds.has(template.template_id)) add(errors, 'DUPLICATE_ID', `${tp}/template_id`, `duplicate template_id ${template.template_id}`);
        globalTemplateIds.add(template.template_id);
      }
    }
  }
  requireUnique(errors, bookIds, '/books');

  if (typeof language.copy_language_hash === 'string' && /^[a-f0-9]{64}$/.test(language.copy_language_hash)) {
    const expected = computeCopyLanguageHash(language);
    if (language.copy_language_hash !== expected) add(errors, 'COPY_LANGUAGE_HASH_MISMATCH', '/copy_language_hash', `expected ${expected}`);
  } else if (typeof language.copy_language_hash === 'string' && language.copy_language_hash.length > 0) {
    add(errors, 'INVALID_SHA256', '/copy_language_hash', 'copy_language_hash must be lowercase sha256 hex');
  }

  return { valid: errors.length === 0, code: errors.length ? 'INVALID_SERVER_COPY_LANGUAGE' : 'OK', errors: sortedErrors(errors) };
}

function intersectSets(sets) {
  if (!sets.length) return new Set();
  const result = new Set(sets[0]);
  for (const set of sets.slice(1)) for (const value of [...result]) if (!set.has(value)) result.delete(value);
  return result;
}

function materializeExpression({ pack, language, proposalBookId, angleType, expression, expectedRole, path, errors }) {
  const startErrorCount = errors.length;
  if (!isObject(expression)) {
    add(errors, 'TYPE_OBJECT_REQUIRED', path, `${expectedRole} expression must be an object`);
    return null;
  }
  checkUnknownKeys(errors, expression, new Set(['template_id', 'bindings']), path, { forbidRaw: true });
  requireString(errors, expression.template_id, `${path}/template_id`);
  if (!Array.isArray(expression.bindings) || expression.bindings.length === 0) add(errors, 'INVALID_ARRAY', `${path}/bindings`, 'bindings must be a non-empty array');

  const lidx = languageIndexes(language);
  const bookLanguage = lidx.books.get(proposalBookId);
  let template = null;
  const globalTemplate = lidx.templates.get(expression.template_id);
  if (!globalTemplate) add(errors, 'UNKNOWN_TEMPLATE', `${path}/template_id`, `unknown template ${expression.template_id}`);
  else if (globalTemplate.book_id !== proposalBookId) add(errors, 'TEMPLATE_SCOPE_MISMATCH', `${path}/template_id`, `template ${expression.template_id} belongs to ${globalTemplate.book_id}, not ${proposalBookId}`);
  else template = globalTemplate.template;

  if (template) {
    if (template.role !== expectedRole) add(errors, 'TEMPLATE_ROLE_MISMATCH', `${path}/template_id`, `template ${template.template_id} has role ${template.role}, expected ${expectedRole}`);
    if (!template.angle_types.includes(angleType)) add(errors, 'TEMPLATE_ANGLE_MISMATCH', `${path}/template_id`, `template ${template.template_id} does not allow angle ${angleType}`);
  }

  const bindingBySlot = new Map();
  for (let bi = 0; bi < (Array.isArray(expression.bindings) ? expression.bindings.length : 0); bi += 1) {
    const binding = expression.bindings[bi];
    const bp = `${path}/bindings/${bi}`;
    if (!isObject(binding)) { add(errors, 'TYPE_OBJECT_REQUIRED', bp, 'binding must be an object'); continue; }
    checkUnknownKeys(errors, binding, new Set(['slot_id', 'form_id']), bp, { forbidRaw: true });
    requireString(errors, binding.slot_id, `${bp}/slot_id`);
    requireString(errors, binding.form_id, `${bp}/form_id`);
    if (typeof binding.slot_id === 'string') {
      if (bindingBySlot.has(binding.slot_id)) add(errors, 'DUPLICATE_BINDING', `${bp}/slot_id`, `slot ${binding.slot_id} is bound more than once`);
      else bindingBySlot.set(binding.slot_id, { binding, path: bp });
    }
  }

  const slotParts = template ? template.parts.filter((part) => part.kind === 'slot') : [];
  const slotIds = new Set(slotParts.map((part) => part.slot_id));
  if (template) {
    for (const slot of slotParts) if (!bindingBySlot.has(slot.slot_id)) add(errors, 'MISSING_SLOT_BINDING', `${path}/bindings`, `missing binding for slot ${slot.slot_id}`);
    for (const [slotId, meta] of bindingBySlot.entries()) if (!slotIds.has(slotId)) add(errors, 'UNKNOWN_SLOT_BINDING', `${meta.path}/slot_id`, `template ${template.template_id} has no slot ${slotId}`);
  }

  const ctx = contextIndexes(pack);
  const selectedContextBook = ctx.books.get(proposalBookId);
  const resolved = new Map();
  if (template && selectedContextBook) {
    for (const slot of slotParts) {
      const meta = bindingBySlot.get(slot.slot_id);
      if (!meta) continue;
      const globalForm = lidx.forms.get(meta.binding.form_id);
      if (!globalForm) { add(errors, 'UNKNOWN_FORM', `${meta.path}/form_id`, `unknown form ${meta.binding.form_id}`); continue; }
      if (globalForm.book_id !== proposalBookId) { add(errors, 'FORM_SCOPE_MISMATCH', `${meta.path}/form_id`, `form ${meta.binding.form_id} belongs to ${globalForm.book_id}, not ${proposalBookId}`); continue; }
      const form = globalForm.form;
      const fact = selectedContextBook.facts.get(form.fact_id);
      if (!fact) { add(errors, 'UNKNOWN_FACT', `${meta.path}/form_id`, `form ${form.form_id} references unknown fact ${form.fact_id}`); continue; }
      if (!slot.fact_kinds.includes(fact.kind)) add(errors, 'FACT_KIND_MISMATCH', `${meta.path}/form_id`, `slot ${slot.slot_id} accepts ${slot.fact_kinds.join(',')}, fact ${fact.fact_id} has kind ${fact.kind}`);
      if (!slot.surface_types.includes(form.surface_type)) add(errors, 'SURFACE_TYPE_MISMATCH', `${meta.path}/form_id`, `slot ${slot.slot_id} accepts ${slot.surface_types.join(',')}, form ${form.form_id} has ${form.surface_type}`);
      resolved.set(slot.slot_id, { form, fact });
    }
  }

  if (template && resolved.size === slotParts.length) {
    const facts = [...resolved.values()].map((x) => x.fact.fact_id);
    if (!template.allow_fact_reuse) {
      for (const duplicate of duplicateValues(facts)) add(errors, 'FACT_REUSE_FORBIDDEN', `${path}/bindings`, `fact ${duplicate} may not fill multiple slots in template ${template.template_id}`);
    }
    if (template.require_shared_group && resolved.size > 1) {
      const shared = intersectSets([...resolved.values()].map((x) => new Set(x.form.composition_groups || [])));
      if (shared.size === 0) add(errors, 'COMPOSITION_GROUP_MISMATCH', `${path}/bindings`, `template ${template.template_id} requires all forms to share a composition group`);
    }
    const spoilerLevel = Math.max(...[...resolved.values()].map((x) => x.form.spoiler_level));
    if (spoilerLevel > pack.constraints.max_spoiler_level) add(errors, 'SPOILER_BUDGET_EXCEEDED', path, `composed ${expectedRole} spoiler level ${spoilerLevel} exceeds ${pack.constraints.max_spoiler_level}`);
  }

  if (errors.length !== startErrorCount || !template || resolved.size !== slotParts.length) return null;

  const text = template.parts.map((part) => part.kind === 'literal' ? part.text : resolved.get(part.slot_id).form.text).join('');
  if (text.length > template.max_output_chars) {
    add(errors, 'COPY_LENGTH_EXCEEDED', path, `materialized copy length ${text.length} exceeds template limit ${template.max_output_chars}`);
    return null;
  }

  const bindings = slotParts.map((slot) => {
    const { form, fact } = resolved.get(slot.slot_id);
    return { slot_id: slot.slot_id, form_id: form.form_id, fact_id: fact.fact_id };
  });
  const sourceFactIds = [...new Set(bindings.map((x) => x.fact_id))].sort();
  const spoilerLevel = Math.max(...bindings.map((binding) => lidx.forms.get(binding.form_id).form.spoiler_level));
  const program = {
    schema: COPY_PROGRAM_SCHEMA,
    context_hash: pack.context_hash,
    copy_language_hash: language.copy_language_hash,
    book_id: proposalBookId,
    role: expectedRole,
    angle_type: angleType,
    template_id: template.template_id,
    bindings,
    source_fact_ids: sourceFactIds,
    spoiler_level: spoilerLevel,
    text,
  };
  program.copy_program_id = computeCopyProgramId(program);
  return program;
}

function checkExpressionStructure(errors, expression, path) {
  if (!isObject(expression)) { add(errors, 'TYPE_OBJECT_REQUIRED', path, 'copy expression must be an object'); return; }
  checkUnknownKeys(errors, expression, new Set(['template_id', 'bindings']), path, { forbidRaw: true });
  requireString(errors, expression.template_id, `${path}/template_id`);
  if (!Array.isArray(expression.bindings) || expression.bindings.length === 0) add(errors, 'INVALID_ARRAY', `${path}/bindings`, 'bindings must be a non-empty array');
}

function proposalStructureErrors(proposal) {
  const errors = [];
  if (!isObject(proposal)) {
    add(errors, 'TYPE_OBJECT_REQUIRED', '', 'ComposedCreativeProposal must be an object');
    return errors;
  }
  checkUnknownKeys(errors, proposal, new Set(['schema', 'proposal_id', 'context_pack_id', 'context_hash', 'copy_language_id', 'copy_language_hash', 'account_id', 'book_id', 'narrative', 'presentation', 'selected_asset_ids']), '', { forbidRaw: true });
  if (proposal.schema !== COMPOSED_PROPOSAL_SCHEMA) add(errors, 'SCHEMA_VERSION_MISMATCH', '/schema', `expected ${COMPOSED_PROPOSAL_SCHEMA}`);
  if (hasOwn(proposal, 'proposal_id')) requireString(errors, proposal.proposal_id, '/proposal_id');
  requireString(errors, proposal.context_pack_id, '/context_pack_id');
  requireString(errors, proposal.context_hash, '/context_hash');
  requireString(errors, proposal.copy_language_id, '/copy_language_id');
  requireString(errors, proposal.copy_language_hash, '/copy_language_hash');
  requireString(errors, proposal.account_id, '/account_id');
  requireString(errors, proposal.book_id, '/book_id');

  if (!isObject(proposal.narrative)) add(errors, 'TYPE_OBJECT_REQUIRED', '/narrative', 'narrative must be an object');
  else {
    checkUnknownKeys(errors, proposal.narrative, new Set(['angle_type', 'hook', 'tension', 'payoff', 'reveal_timing', 'cta_treatment', 'cta_id']), '/narrative', { forbidRaw: true });
    requireString(errors, proposal.narrative.angle_type, '/narrative/angle_type');
    checkExpressionStructure(errors, proposal.narrative.hook, '/narrative/hook');
    if (hasOwn(proposal.narrative, 'tension')) checkExpressionStructure(errors, proposal.narrative.tension, '/narrative/tension');
    if (hasOwn(proposal.narrative, 'payoff')) checkExpressionStructure(errors, proposal.narrative.payoff, '/narrative/payoff');
    requireString(errors, proposal.narrative.reveal_timing, '/narrative/reveal_timing');
    requireString(errors, proposal.narrative.cta_treatment, '/narrative/cta_treatment');
    if (hasOwn(proposal.narrative, 'cta_id')) requireString(errors, proposal.narrative.cta_id, '/narrative/cta_id');
  }

  if (!isObject(proposal.presentation)) add(errors, 'TYPE_OBJECT_REQUIRED', '/presentation', 'presentation must be an object');
  else {
    checkUnknownKeys(errors, proposal.presentation, new Set(['duration_seconds', 'fps', 'visual_system', 'delivery_profile', 'seed']), '/presentation', { forbidRaw: true });
    requireInteger(errors, proposal.presentation.duration_seconds, '/presentation/duration_seconds', { min: 1 });
    requireInteger(errors, proposal.presentation.fps, '/presentation/fps', { min: 1 });
    requireString(errors, proposal.presentation.visual_system, '/presentation/visual_system');
    requireString(errors, proposal.presentation.delivery_profile, '/presentation/delivery_profile');
    requireInteger(errors, proposal.presentation.seed, '/presentation/seed', { min: 0 });
  }

  const assets = requireStringArray(errors, proposal.selected_asset_ids, '/selected_asset_ids', { minItems: 1 });
  requireUnique(errors, assets, '/selected_asset_ids');
  return errors;
}

function derivedAtom(copyProgram, angleType) {
  return {
    atom_id: `c32_${copyProgram.copy_program_id.slice('nbcopy1_'.length)}`,
    role: copyProgram.role,
    angle_types: [angleType],
    text: copyProgram.text,
    source_fact_ids: [...copyProgram.source_fact_ids],
    spoiler_level: copyProgram.spoiler_level,
  };
}

function buildC31Bridge(pack, proposal, proposalId, copyPrograms) {
  const derivedPack = structuredClone(pack);
  derivedPack.context_pack_id = `${pack.context_pack_id}:c32:${proposalId.slice(-16)}`;
  const selectedBook = derivedPack.books.find((book) => book.book_id === proposal.book_id);
  const byRole = new Map(copyPrograms.map((program) => [program.role, program]));
  for (const program of copyPrograms) selectedBook.creative_atoms.push(derivedAtom(program, proposal.narrative.angle_type));
  derivedPack.context_hash = computeContextHash(derivedPack);

  const internalProposal = {
    schema: PROPOSAL_SCHEMA,
    proposal_id: '',
    context_pack_id: derivedPack.context_pack_id,
    context_hash: derivedPack.context_hash,
    account_id: proposal.account_id,
    book_id: proposal.book_id,
    narrative: {
      angle_type: proposal.narrative.angle_type,
      hook_atom_id: derivedAtom(byRole.get('hook'), proposal.narrative.angle_type).atom_id,
      ...(byRole.has('tension') ? { tension_atom_id: derivedAtom(byRole.get('tension'), proposal.narrative.angle_type).atom_id } : {}),
      ...(byRole.has('payoff') ? { payoff_atom_id: derivedAtom(byRole.get('payoff'), proposal.narrative.angle_type).atom_id } : {}),
      reveal_timing: proposal.narrative.reveal_timing,
      cta_treatment: proposal.narrative.cta_treatment,
      ...(proposal.narrative.cta_id ? { cta_id: proposal.narrative.cta_id } : {}),
    },
    presentation: structuredClone(proposal.presentation),
    selected_asset_ids: [...proposal.selected_asset_ids],
  };
  internalProposal.proposal_id = computeProposalId(internalProposal);
  return { derivedPack, internalProposal };
}

function externalizeC31Error(error) {
  const pathMap = new Map([
    ['/narrative/hook_atom_id', '/narrative/hook'],
    ['/narrative/tension_atom_id', '/narrative/tension'],
    ['/narrative/payoff_atom_id', '/narrative/payoff'],
  ]);
  return { ...error, path: pathMap.get(error.path) || error.path };
}

export function validateComposedCreativeProposal(pack, language, proposal) {
  const contextReport = validateContextPack(pack);
  if (!contextReport.valid) return { valid: false, code: 'INVALID_SERVER_CONTEXT', errors: contextReport.errors };
  const languageReport = validateCopyLanguage(pack, language);
  if (!languageReport.valid) return { valid: false, code: 'INVALID_SERVER_COPY_LANGUAGE', errors: languageReport.errors };

  const errors = proposalStructureErrors(proposal);
  if (!isObject(proposal)) return { valid: false, code: 'COMPOSED_CREATIVE_PROPOSAL_REJECTED', errors: sortedErrors(errors) };

  if (proposal.context_pack_id !== pack.context_pack_id) add(errors, 'CONTEXT_ID_MISMATCH', '/context_pack_id', `expected ${pack.context_pack_id}`);
  if (proposal.context_hash !== pack.context_hash) add(errors, 'CONTEXT_HASH_MISMATCH', '/context_hash', `expected ${pack.context_hash}`);
  if (proposal.copy_language_id !== language.copy_language_id) add(errors, 'COPY_LANGUAGE_ID_MISMATCH', '/copy_language_id', `expected ${language.copy_language_id}`);
  if (proposal.copy_language_hash !== language.copy_language_hash) add(errors, 'COPY_LANGUAGE_HASH_MISMATCH', '/copy_language_hash', `expected ${language.copy_language_hash}`);
  if (proposal.account_id !== pack.account.account_id) add(errors, 'ACCOUNT_SCOPE_MISMATCH', '/account_id', `expected ${pack.account.account_id}`);

  const ctx = contextIndexes(pack);
  const bookExists = ctx.books.has(proposal.book_id);
  if (!bookExists) add(errors, 'UNKNOWN_BOOK', '/book_id', `book ${proposal.book_id} is not in this ContextPack`);
  if (!languageIndexes(language).books.has(proposal.book_id)) add(errors, 'COPY_LANGUAGE_BOOK_MISSING', '/book_id', `copy language has no entry for book ${proposal.book_id}`);

  const copyPrograms = [];
  if (bookExists && isObject(proposal.narrative)) {
    const hook = materializeExpression({ pack, language, proposalBookId: proposal.book_id, angleType: proposal.narrative.angle_type, expression: proposal.narrative.hook, expectedRole: 'hook', path: '/narrative/hook', errors });
    if (hook) copyPrograms.push(hook);
    if (hasOwn(proposal.narrative, 'tension')) {
      const tension = materializeExpression({ pack, language, proposalBookId: proposal.book_id, angleType: proposal.narrative.angle_type, expression: proposal.narrative.tension, expectedRole: 'tension', path: '/narrative/tension', errors });
      if (tension) copyPrograms.push(tension);
    }
    if (hasOwn(proposal.narrative, 'payoff')) {
      const payoff = materializeExpression({ pack, language, proposalBookId: proposal.book_id, angleType: proposal.narrative.angle_type, expression: proposal.narrative.payoff, expectedRole: 'payoff', path: '/narrative/payoff', errors });
      if (payoff) copyPrograms.push(payoff);
    }
  }

  const proposalId = computeComposedProposalId(proposal);
  if (hasOwn(proposal, 'proposal_id')) {
    if (!/^nbcp1_[a-f0-9]{64}$/.test(proposal.proposal_id || '')) add(errors, 'PROPOSAL_ID_INVALID', '/proposal_id', 'proposal_id must match nbcp1_<sha256>');
    else if (proposal.proposal_id !== proposalId) add(errors, 'PROPOSAL_ID_MISMATCH', '/proposal_id', `expected ${proposalId}`);
  }

  if (errors.length === 0) {
    const { derivedPack, internalProposal } = buildC31Bridge(pack, proposal, proposalId, copyPrograms);
    const c31Report = validateCreativeProposal(derivedPack, internalProposal);
    if (!c31Report.valid) for (const error of c31Report.errors) add(errors, error.code, externalizeC31Error(error).path, error.message);
    if (errors.length === 0) {
      return {
        valid: true,
        code: 'OK',
        errors: [],
        proposal_id: proposalId,
        copy_programs: copyPrograms,
        bridge: { derived_pack: derivedPack, internal_proposal: internalProposal },
      };
    }
  }

  return { valid: false, code: 'COMPOSED_CREATIVE_PROPOSAL_REJECTED', errors: sortedErrors(errors), proposal_id: proposalId };
}

export class ComposedCreativeProposalValidationError extends Error {
  constructor(report) {
    super(`ComposedCreativeProposal rejected with ${report.errors.length} error(s)`);
    this.name = 'ComposedCreativeProposalValidationError';
    this.report = report;
  }
}

export function compileComposedCreativeProposal(pack, language, proposal) {
  const report = validateComposedCreativeProposal(pack, language, proposal);
  if (!report.valid) throw new ComposedCreativeProposalValidationError(report);

  const c31Program = compileCreativeProposal(report.bridge.derived_pack, report.bridge.internal_proposal);
  const program = {
    schema: COMPOSED_PROGRAM_SCHEMA,
    proposal_id: report.proposal_id,
    source_context: {
      context_pack_id: pack.context_pack_id,
      context_hash: pack.context_hash,
    },
    copy_language: {
      copy_language_id: language.copy_language_id,
      copy_language_hash: language.copy_language_hash,
    },
    account_id: proposal.account_id,
    book_id: proposal.book_id,
    copy_programs: report.copy_programs,
    c31_bridge: {
      context_pack_id: report.bridge.derived_pack.context_pack_id,
      context_hash: report.bridge.derived_pack.context_hash,
      proposal_id: report.bridge.internal_proposal.proposal_id,
      program_id: c31Program.program_id,
    },
    narrative_plan: c31Program.narrative_plan,
    presentation: c31Program.presentation,
    assets: c31Program.assets,
  };
  program.program_id = computeComposedProgramId(program);
  return program;
}
