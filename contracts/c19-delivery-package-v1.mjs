import { canonicalJson, computeCreativeId, computeRenderSpecId, assertFactoryIds } from './factory-identity-v1.mjs';
import { validateTemplateCampaignSelectionProvenance } from './template-campaign-selection-v1.mjs';

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertTimeline(timeline) {
  assertObject(timeline, 'timeline');
  if (!Number.isInteger(timeline.frame_count) || timeline.frame_count <= 0) throw new Error('timeline.frame_count must be a positive integer');
  if (!Number.isInteger(timeline.duration_ms) || timeline.duration_ms <= 0) throw new Error('timeline.duration_ms must be a positive integer');
  if (typeof timeline.source !== 'string' || !timeline.source) throw new Error('timeline.source is required');
  if (typeof timeline.policy_version !== 'string' || !timeline.policy_version) throw new Error('timeline.policy_version is required');
}

function compileCreative(input) {
  assertObject(input, 'selected creative');
  const creative = structuredClone(input.creative);
  delete creative.creative_id;
  creative.creative_id = computeCreativeId(creative);
  return creative;
}

function compileDelivery(profile, timeline) {
  assertObject(profile, 'delivery profile');
  const delivery = {
    id: profile.id,
    width: profile.width,
    height: profile.height,
    fps: profile.fps,
    duration_ms: timeline.duration_ms,
  };
  if (profile.safe_area_profile) delivery.safe_area_profile = profile.safe_area_profile;
  if (profile.platform_ui_profile || profile.platform_ui_version) {
    delivery.platform_ui_profile = profile.platform_ui_profile;
    delivery.platform_ui_version = profile.platform_ui_version;
  }
  return delivery;
}

function compileRender(creative, selected, profile, runtime) {
  assertTimeline(selected.timeline);
  const render = {
    schema: 'newboo-render-spec-v1',
    creative_id: creative.creative_id,
    duration_ms: selected.timeline.duration_ms,
    frame_count: selected.timeline.frame_count,
    delivery: compileDelivery(profile, selected.timeline),
    runtime: structuredClone(runtime),
    assets: structuredClone(selected.render_assets || []),
    artifact_policy: { reuse: 'prefer-existing', canonical_key: 'render_spec_id' },
  };
  if (selected.audio) render.audio = structuredClone(selected.audio);
  render.render_spec_id = computeRenderSpecId(render);
  assertFactoryIds({ creative, render });
  return render;
}

function orderedSelectedRows(request) {
  const anyOrder = request.selected.some(row => row.selection_order != null);
  if (!anyOrder) return [...request.selected].sort((a, b) => String(a.selection_id).localeCompare(String(b.selection_id)));
  if (request.selected.some(row => !Number.isInteger(row.selection_order) || row.selection_order < 0)) {
    throw new Error('selection_order must be a non-negative integer on every selected row when ordering is present');
  }
  if (new Set(request.selected.map(row => row.selection_order)).size !== request.selected.length) throw new Error('selection_order values must be unique');
  return [...request.selected].sort((a, b) => a.selection_order - b.selection_order || String(a.selection_id).localeCompare(String(b.selection_id)));
}

export function compileDeliveryPackage(request) {
  assertObject(request, 'campaign request');
  if (request.schema !== 'framewright-c19-campaign-request-v1') throw new Error(`unexpected request schema: ${request.schema}`);
  if (!Array.isArray(request.selected) || request.selected.length === 0) throw new Error('request.selected must be non-empty');
  if (!Array.isArray(request.reserves)) throw new Error('request.reserves must be an array');
  if (!Array.isArray(request.delivery_profiles) || request.delivery_profiles.length === 0) throw new Error('request.delivery_profiles must be non-empty');
  assertObject(request.runtime, 'runtime');
  if (request.selection_provenance != null) {
    const report = validateTemplateCampaignSelectionProvenance(request.selection_provenance);
    if (!report.valid) throw new Error(`selection_provenance rejected: ${JSON.stringify(report.errors)}`);
  }

  const deliveryById = new Map(request.delivery_profiles.map(p => [p.id, p]));
  if (deliveryById.size !== request.delivery_profiles.length) throw new Error('duplicate delivery profile id');

  const creatives = [];
  const renders = [];
  const selectedRows = orderedSelectedRows(request);
  for (const selected of selectedRows) {
    if (!selected.selection_id) throw new Error('selected.selection_id is required');
    assertTimeline(selected.timeline);
    const creative = compileCreative(selected);
    const selectedRow = { selection_id: selected.selection_id, creative, timeline: structuredClone(selected.timeline) };
    if (selected.selection_order != null) selectedRow.selection_order = selected.selection_order;
    creatives.push(selectedRow);
    const requested = [...new Set(selected.requested_delivery_profile_ids || [])].sort();
    if (requested.length === 0) throw new Error(`${selected.selection_id}: no requested delivery profiles`);
    for (const profileId of requested) {
      const profile = deliveryById.get(profileId);
      if (!profile) throw new Error(`${selected.selection_id}: unknown delivery profile ${profileId}`);
      const renderRow = { selection_id: selected.selection_id, delivery_profile_id: profileId, render: compileRender(creative, selected, profile, request.runtime) };
      if (selected.selection_order != null) renderRow.selection_order = selected.selection_order;
      renders.push(renderRow);
    }
  }

  const selectedIds = new Set(creatives.map(x => x.selection_id));
  const reserves = request.reserves
    .map(x => ({ reserve_id: x.reserve_id, reason: x.reason || null }))
    .sort((a, b) => String(a.reserve_id).localeCompare(String(b.reserve_id)));
  for (const reserve of reserves) {
    if (!reserve.reserve_id) throw new Error('reserve.reserve_id is required');
    if (selectedIds.has(reserve.reserve_id)) throw new Error(`reserve ${reserve.reserve_id} is also selected`);
  }

  const manifest = {
    schema: 'framewright-c19-delivery-package-v1',
    campaign_id: request.campaign_id,
    compiler_policy_version: request.compiler_policy_version || 'c19-delivery-package-v1',
    selected: creatives,
    renders,
    reserves,
    counts: {
      selected_creatives: creatives.length,
      render_specs: renders.length,
      reserves: reserves.length,
    },
  };
  if (request.selection_provenance != null) manifest.selection_provenance = structuredClone(request.selection_provenance);
  return manifest;
}

export function serializeDeliveryPackage(request) {
  return `${canonicalJson(compileDeliveryPackage(request))}\n`;
}
