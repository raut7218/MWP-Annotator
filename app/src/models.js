// Model identity as it is exposed to the browser.
//
// Which LLM generated a problem is a *hidden* field: it is recorded on every
// row so the team can do model-specific analysis later, but an annotator only
// learns it if their account has `can_see_model` switched on by an admin.
//
// To make that real rather than cosmetic, the browser never receives (or sends)
// the model name itself — it uses an opaque ref derived with an HMAC, so a
// blinded annotator cannot read the model out of a URL, a network response, or
// localStorage. Users who ARE allowed to see it get the real name alongside the
// ref, and the ref stays the addressing scheme for everyone so there is only
// one code path to get wrong.
import crypto from 'node:crypto';

const REF_SECRET =
  process.env.MODEL_REF_SECRET || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

export function modelRef(model) {
  return crypto.createHmac('sha256', REF_SECRET).update(`model:${model}`).digest('hex').slice(0, 16);
}

// Blinded annotators still need to tell the sets apart (to pick one, to resume
// where they left off), so each model gets a neutral positional label derived
// from the sorted list of all models — stable, and giving nothing away.
export function anonymousLabel(model, allModelsSorted) {
  const i = allModelsSorted.indexOf(model);
  return i >= 0 ? `Set ${i + 1}` : 'Set ?';
}

export function modelLabel(model, user, allModelsSorted) {
  return user?.canSeeModel ? model : anonymousLabel(model, allModelsSorted);
}

// Resolve an opaque ref back to a model name. `candidates` is the list of
// models that exist; an unknown ref simply returns null (the caller turns that
// into a 404/403 rather than leaking whether the model exists).
export function modelFromRef(ref, candidates) {
  for (const m of candidates) {
    if (modelRef(m) === ref) return m;
  }
  return null;
}

export function describeModel(model, user, allModelsSorted) {
  return {
    ref: modelRef(model),
    label: modelLabel(model, user, allModelsSorted),
    // Only ever populated for users allowed to see it; the client shows this
    // when present and falls back to `label` otherwise.
    name: user?.canSeeModel ? model : null,
  };
}
