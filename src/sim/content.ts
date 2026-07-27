import { StateHasher } from "./rng";
import type {
  AbilityTemplate,
  BattleContentBundle,
  EffectDefinition,
  EraTemplate,
  GroupTemplate,
  MemberTemplate,
  PlatformTemplate,
  SensorTemplate,
  StatusTemplate,
  TemplateId,
  WeaponTemplate,
} from "./types";

export const BATTLE_CONTENT_VERSION = "content-1" as const;
export const DEFAULT_ERA_ID = "era-default-v1" as const;
export const DEFAULT_GROUP_TEMPLATE_ID = "infantry-rifle-squad-v1" as const;
export const DEFAULT_MEMBER_TEMPLATE_ID = "infantry-rifleman-v1" as const;
export const DEFAULT_SENSOR_TEMPLATE_ID = "infantry-eyesight-v1" as const;
export const DEFAULT_WEAPON_TEMPLATE_ID = "rifle-standard-v1" as const;

const DEFAULT_CELL_SIZE_MM = 4_000;

export interface DefaultBattleContentOptions {
  readonly cellSizeMm?: number;
  readonly sightRangeCells?: number;
  readonly weaponRangeCells?: number;
  readonly preferredRangeCells?: number;
  readonly contactForgetTicks?: number;
}

export function createDefaultBattleContent(
  options: DefaultBattleContentOptions = {},
): BattleContentBundle {
  const cellSizeMm = options.cellSizeMm ?? DEFAULT_CELL_SIZE_MM;
  const weaponRangeCells = options.weaponRangeCells ?? 11;
  const preferredRangeCells = Math.min(options.preferredRangeCells ?? 7, weaponRangeCells);
  const era: EraTemplate = {
    id: DEFAULT_ERA_ID,
    displayName: "默认时代",
    tags: ["default"],
    allowedGroupTemplateIds: [DEFAULT_GROUP_TEMPLATE_ID],
    allowedMemberTemplateIds: [DEFAULT_MEMBER_TEMPLATE_ID],
    allowedWeaponTemplateIds: [DEFAULT_WEAPON_TEMPLATE_ID],
    allowedSensorTemplateIds: [DEFAULT_SENSOR_TEMPLATE_ID],
  };
  const group: GroupTemplate = {
    id: DEFAULT_GROUP_TEMPLATE_ID,
    tags: ["infantry", "squad"],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-firearms"],
    memberSlotRules: [
      {
        slotId: "riflemen",
        memberTemplateId: DEFAULT_MEMBER_TEMPLATE_ID,
        count: 8,
        required: true,
      },
    ],
    platformSlotRules: [],
    cohesionRadiusCells: 2,
    capturePowerScaleBps: 10_000,
    behaviorProfileId: "infantry-basic",
  };
  const member: MemberTemplate = {
    id: DEFAULT_MEMBER_TEMPLATE_ID,
    tags: ["infantry", "rifleman"],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-firearms"],
    movementType: "foot",
    sensorTemplateId: DEFAULT_SENSOR_TEMPLATE_ID,
    weaponSlotRules: [
      {
        slotId: "primary",
        weaponTemplateId: DEFAULT_WEAPON_TEMPLATE_ID,
        count: 1,
        required: true,
      },
    ],
    roleTags: ["rifleman"],
    silhouetteId: "infantry",
    protectionBps: 0,
    suppressionResistanceBps: 0,
    capturePowerBps: 10_000,
  };
  const sensor: SensorTemplate = {
    id: DEFAULT_SENSOR_TEMPLATE_ID,
    rangeMm: (options.sightRangeCells ?? 13) * cellSizeMm,
    acquisitionTicks: 1,
    contactForgetTicks: options.contactForgetTicks ?? 400,
    tags: ["visual", "human"]
  };
  const weapon: WeaponTemplate = {
    id: DEFAULT_WEAPON_TEMPLATE_ID,
    tags: ["small-arms", "rifle"],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-firearms"],
    targetDomains: ["ground"],
    minimumRangeMm: Math.min(1, weaponRangeCells) * cellSizeMm,
    optimalRangeMm: preferredRangeCells * cellSizeMm,
    maximumRangeMm: weaponRangeCells * cellSizeMm,
    aimTicks: 0,
    magazineSize: 12,
    reloadTicks: 36,
    shotIntervalTicks: 7,
    firePattern: { kind: "single", shotsPerAction: 1 },
    trajectory: "resolved",
    damageEffects: [
      { kind: "damage", amountBps: 10_000 },
      { kind: "suppression", amountBps: 90 },
    ],
    suppressionBps: 22,
    exposureOnFireBps: 1_100,
  };

  return {
    contentVersion: BATTLE_CONTENT_VERSION,
    eraId: DEFAULT_ERA_ID,
    eraTemplates: { [era.id]: era },
    groupTemplates: { [group.id]: group },
    memberTemplates: { [member.id]: member },
    platformTemplates: {},
    weaponTemplates: { [weapon.id]: weapon },
    sensorTemplates: { [sensor.id]: sensor },
    abilityTemplates: {},
    statusTemplates: {},
    terrainCatalog: { version: "map-2" },
  };
}

export function cloneBattleContent(content: BattleContentBundle): BattleContentBundle {
  return {
    ...content,
    eraTemplates: cloneRecord(content.eraTemplates, cloneEraTemplate),
    groupTemplates: cloneRecord(content.groupTemplates, cloneGroupTemplate),
    memberTemplates: cloneRecord(content.memberTemplates, cloneMemberTemplate),
    platformTemplates: cloneRecord(content.platformTemplates, cloneSimpleTemplate),
    weaponTemplates: cloneRecord(content.weaponTemplates, cloneWeaponTemplate),
    sensorTemplates: cloneRecord(content.sensorTemplates, cloneSensorTemplate),
    abilityTemplates: cloneRecord(content.abilityTemplates, cloneSimpleTemplate),
    statusTemplates: cloneRecord(content.statusTemplates, cloneSimpleTemplate),
    terrainCatalog: { ...content.terrainCatalog },
  };
}

export function validateBattleContent(content: BattleContentBundle): void {
  if (content.contentVersion !== BATTLE_CONTENT_VERSION) {
    throw new Error(`Unsupported battle content version: ${content.contentVersion}.`);
  }
  if (!content.eraId || !content.eraTemplates[content.eraId]) {
    throw new Error(`Battle content references an unknown era: ${content.eraId}.`);
  }
  validateRecord(content.eraTemplates, "era", validateEraTemplate);
  validateRecord(content.groupTemplates, "group", validateGroupTemplate);
  validateRecord(content.memberTemplates, "member", validateMemberTemplate);
  validateRecord(content.weaponTemplates, "weapon", validateWeaponTemplate);
  validateRecord(content.sensorTemplates, "sensor", validateSensorTemplate);
  validateRecord(content.platformTemplates, "platform", validateSimpleTemplate);
  validateRecord(content.abilityTemplates, "ability", validateSimpleTemplate);
  validateRecord(content.statusTemplates, "status", validateSimpleTemplate);
  if (!content.terrainCatalog.version) {
    throw new Error("Battle content terrain catalog requires a version.");
  }

  for (const group of Object.values(content.groupTemplates)) {
    for (const slot of group.memberSlotRules) {
      if (!content.memberTemplates[slot.memberTemplateId]) {
        throw new Error(`Group template ${group.id} references an unknown member template.`);
      }
    }
  }
  for (const member of Object.values(content.memberTemplates)) {
    if (!content.sensorTemplates[member.sensorTemplateId]) {
      throw new Error(`Member template ${member.id} references an unknown sensor template.`);
    }
    for (const slot of member.weaponSlotRules) {
      if (!content.weaponTemplates[slot.weaponTemplateId]) {
        throw new Error(`Member template ${member.id} references an unknown weapon template.`);
      }
    }
  }

  const era = content.eraTemplates[content.eraId]!;
  validateAllowedIds(era.allowedGroupTemplateIds, content.groupTemplates, "group", era.id);
  validateAllowedIds(era.allowedMemberTemplateIds, content.memberTemplates, "member", era.id);
  validateAllowedIds(era.allowedWeaponTemplateIds, content.weaponTemplates, "weapon", era.id);
  validateAllowedIds(era.allowedSensorTemplateIds, content.sensorTemplates, "sensor", era.id);
  for (const weaponId of era.allowedWeaponTemplateIds) {
    const weapon = content.weaponTemplates[weaponId]!;
    if (
      !weapon.targetDomains.includes("ground") ||
      weapon.trajectory !== "resolved" ||
      weapon.firePattern.kind !== "single" ||
      weapon.firePattern.shotsPerAction !== 1 ||
      weapon.aimTicks !== 0
    ) {
      throw new Error(`Weapon template ${weapon.id} uses capabilities not supported by content-1.`);
    }
  }
  for (const group of Object.values(content.groupTemplates)) {
    if (!era.allowedGroupTemplateIds.includes(group.id)) {
      continue;
    }
    if (group.behaviorProfileId !== "infantry-basic") {
      throw new Error(`Group template ${group.id} uses an unsupported behavior profile.`);
    }
    for (const slot of group.memberSlotRules) {
      if (!era.allowedMemberTemplateIds.includes(slot.memberTemplateId)) {
        throw new Error(`Group template ${group.id} references a member outside era ${era.id}.`);
      }
    }
  }
  for (const member of Object.values(content.memberTemplates)) {
    if (!era.allowedMemberTemplateIds.includes(member.id)) {
      continue;
    }
    if (member.weaponSlotRules.reduce((sum, slot) => sum + slot.count, 0) !== 1) {
      throw new Error(`Member template ${member.id} must resolve to one content-1 weapon.`);
    }
    if (!era.allowedSensorTemplateIds.includes(member.sensorTemplateId)) {
      throw new Error(`Member template ${member.id} references a sensor outside era ${era.id}.`);
    }
    for (const slot of member.weaponSlotRules) {
      if (!era.allowedWeaponTemplateIds.includes(slot.weaponTemplateId)) {
        throw new Error(`Member template ${member.id} references a weapon outside era ${era.id}.`);
      }
    }
  }
}

export function hashBattleContent(content: BattleContentBundle): string {
  const hasher = new StateHasher();
  hasher.addString(content.contentVersion);
  hasher.addString(content.eraId);
  hashRecord(hasher, "era", content.eraTemplates, hashEraTemplate);
  hashRecord(hasher, "group", content.groupTemplates, hashGroupTemplate);
  hashRecord(hasher, "member", content.memberTemplates, hashMemberTemplate);
  hashRecord(hasher, "platform", content.platformTemplates, hashSimpleTemplate);
  hashRecord(hasher, "weapon", content.weaponTemplates, hashWeaponTemplate);
  hashRecord(hasher, "sensor", content.sensorTemplates, hashSensorTemplate);
  hashRecord(hasher, "ability", content.abilityTemplates, hashSimpleTemplate);
  hashRecord(hasher, "status", content.statusTemplates, hashSimpleTemplate);
  hasher.addString(content.terrainCatalog.version);
  return hasher.digest();
}

export function getGroupTemplate(content: BattleContentBundle, id?: TemplateId): GroupTemplate {
  const resolvedId = id ?? DEFAULT_GROUP_TEMPLATE_ID;
  return content.groupTemplates[resolvedId] ?? missingTemplate("group", resolvedId);
}

export function getMemberTemplate(content: BattleContentBundle, id?: TemplateId): MemberTemplate {
  const resolvedId = id ?? DEFAULT_MEMBER_TEMPLATE_ID;
  return content.memberTemplates[resolvedId] ?? missingTemplate("member", resolvedId);
}

export function getWeaponTemplate(content: BattleContentBundle, id: TemplateId): WeaponTemplate {
  return content.weaponTemplates[id] ?? missingTemplate("weapon", id);
}

export function getPrimaryWeaponTemplate(
  content: BattleContentBundle,
  memberTemplateId?: TemplateId,
): WeaponTemplate {
  const member = getMemberTemplate(content, memberTemplateId);
  const slot = member.weaponSlotRules.find((candidate) => candidate.count > 0);
  if (!slot) {
    throw new Error(`Member template ${member.id} has no usable weapon slot.`);
  }
  return getWeaponTemplate(content, slot.weaponTemplateId);
}

function validateRecord<T extends { readonly id: string }>(
  record: Readonly<Record<string, T>>,
  namespace: string,
  validate: (template: T) => void,
): void {
  for (const [key, template] of Object.entries(record)) {
    if (!key || !template || template.id !== key) {
      throw new Error(`${namespace} template keys and IDs must match and be non-empty.`);
    }
    validate(template);
  }
}

function validateEraTemplate(template: EraTemplate): void {
  if (!template.id || !template.displayName) {
    throw new Error("Era templates require non-empty IDs and display names.");
  }
  for (const ids of [
    template.allowedGroupTemplateIds,
    template.allowedMemberTemplateIds,
    template.allowedWeaponTemplateIds,
    template.allowedSensorTemplateIds,
  ]) {
    if (new Set(ids).size !== ids.length || ids.some((id) => !id)) {
      throw new Error(`Era template ${template.id} has duplicate or empty allow-list IDs.`);
    }
  }
}

function validateGroupTemplate(template: GroupTemplate): void {
  validateTags(template.id, template.tags, template.eraTags, template.techTags);
  if (!Number.isInteger(template.cohesionRadiusCells) || template.cohesionRadiusCells < 0) {
    throw new Error(`Group template ${template.id} has an invalid cohesion radius.`);
  }
  validateBps(template.capturePowerScaleBps, `Group template ${template.id}`);
  if (!template.behaviorProfileId) {
    throw new Error(`Group template ${template.id} requires a behavior profile.`);
  }
  if (template.platformSlotRules.length > 0) {
    throw new Error(`Group template ${template.id} references unsupported platform slots.`);
  }
  validateSlotRules(template.id, template.memberSlotRules, "member");
}

function validateMemberTemplate(template: MemberTemplate): void {
  validateTags(template.id, template.tags, template.eraTags, template.techTags);
  if (template.movementType !== "foot") {
    throw new Error(`Member template ${template.id} uses an unsupported movement type.`);
  }
  if (!template.sensorTemplateId || !template.silhouetteId) {
    throw new Error(`Member template ${template.id} requires sensor and silhouette IDs.`);
  }
  validateBps(template.protectionBps, `Member template ${template.id}`);
  validateBps(template.suppressionResistanceBps, `Member template ${template.id}`);
  validateBps(template.capturePowerBps, `Member template ${template.id}`);
  validateSlotRules(template.id, template.weaponSlotRules, "weapon");
}

function validateWeaponTemplate(template: WeaponTemplate): void {
  validateTags(template.id, template.tags, template.eraTags, template.techTags);
  if (
    !Number.isInteger(template.minimumRangeMm) ||
    !Number.isInteger(template.optimalRangeMm) ||
    !Number.isInteger(template.maximumRangeMm) ||
    template.minimumRangeMm < 0 ||
    template.minimumRangeMm > template.optimalRangeMm ||
    template.optimalRangeMm > template.maximumRangeMm
  ) {
    throw new Error(`Weapon template ${template.id} has invalid range bounds.`);
  }
  if (
    !template.targetDomains.length ||
    template.targetDomains.some((domain) => domain !== "ground" && domain !== "air") ||
    new Set(template.targetDomains).size !== template.targetDomains.length
  ) {
    throw new Error(`Weapon template ${template.id} has invalid target domains.`);
  }
  for (const [label, value, minimum] of [
    ["aimTicks", template.aimTicks, 0],
    ["magazineSize", template.magazineSize, 1],
    ["reloadTicks", template.reloadTicks, 0],
    ["shotIntervalTicks", template.shotIntervalTicks, 1],
  ] as const) {
    if (!Number.isInteger(value) || value < minimum) {
      throw new Error(`Weapon template ${template.id} has invalid ${label}.`);
    }
  }
  if (
    template.firePattern.shotsPerAction < 1 ||
    !Number.isInteger(template.firePattern.shotsPerAction) ||
    (template.firePattern.kind !== "single" && template.firePattern.kind !== "burst")
  ) {
    throw new Error(`Weapon template ${template.id} has an invalid fire pattern.`);
  }
  if (template.trajectory !== "resolved" && template.trajectory !== "logical-projectile") {
    throw new Error(`Weapon template ${template.id} has an invalid trajectory.`);
  }
  validateBps(template.suppressionBps, `Weapon template ${template.id}`, 10_000);
  validateBps(template.exposureOnFireBps, `Weapon template ${template.id}`, 10_000);
  for (const effect of template.damageEffects) {
    if (
      (effect.kind !== "damage" && effect.kind !== "suppression") ||
      !Number.isInteger(effect.amountBps) ||
      effect.amountBps < 0 ||
      effect.amountBps > (effect.kind === "damage" ? 20_000 : 10_000)
    ) {
      throw new Error(`Weapon template ${template.id} has an invalid effect.`);
    }
  }
}

function validateSensorTemplate(template: SensorTemplate): void {
  if (
    !template.id ||
    !Number.isInteger(template.rangeMm) ||
    template.rangeMm < 0 ||
    !Number.isInteger(template.acquisitionTicks) ||
    template.acquisitionTicks < 0 ||
    !Number.isInteger(template.contactForgetTicks) ||
    template.contactForgetTicks <= 0
  ) {
    throw new Error(`Sensor template ${template.id} has invalid fields.`);
  }
}

function validateSimpleTemplate(template: { readonly id: string; readonly tags: readonly string[] }): void {
  if (!template.id || new Set(template.tags).size !== template.tags.length || template.tags.some((tag) => !tag)) {
    throw new Error(`Template ${template.id} has invalid tags.`);
  }
}

function validateSlotRules<T extends { readonly slotId: string; readonly count: number }>(
  templateId: string,
  slots: readonly T[],
  namespace: string,
): void {
  if (
    new Set(slots.map((slot) => slot.slotId)).size !== slots.length ||
    slots.some((slot) => !slot.slotId || !Number.isInteger(slot.count) || slot.count < 1)
  ) {
    throw new Error(`${namespace} slots for template ${templateId} are invalid.`);
  }
}

function validateTags(id: string, ...lists: readonly (readonly string[])[]): void {
  if (!id || lists.some((tags) => new Set(tags).size !== tags.length || tags.some((tag) => !tag))) {
    throw new Error(`Template ${id} has invalid tags.`);
  }
}

function validateBps(value: number, owner: string, maximum = 10_000): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${owner} has an invalid basis-point value.`);
  }
}

function validateAllowedIds<T>(
  ids: readonly string[],
  record: Readonly<Record<string, T>>,
  namespace: string,
  eraId: string,
): void {
  for (const id of ids) {
    if (!record[id]) {
      throw new Error(`Era ${eraId} references an unknown ${namespace} template: ${id}.`);
    }
  }
}

function hashRecord<T>(
  hasher: StateHasher,
  namespace: string,
  record: Readonly<Record<string, T>>,
  hashTemplate: (hasher: StateHasher, template: T) => void,
): void {
  hasher.addString(namespace);
  for (const id of Object.keys(record).sort(compareStrings)) {
    hasher.addString(id);
    hashTemplate(hasher, record[id]!);
  }
}

function hashEraTemplate(hasher: StateHasher, template: EraTemplate): void {
  hasher.addString(template.id);
  addSortedStrings(hasher, template.tags);
  addSortedStrings(hasher, template.allowedGroupTemplateIds);
  addSortedStrings(hasher, template.allowedMemberTemplateIds);
  addSortedStrings(hasher, template.allowedWeaponTemplateIds);
  addSortedStrings(hasher, template.allowedSensorTemplateIds);
}

function hashGroupTemplate(hasher: StateHasher, template: GroupTemplate): void {
  hasher.addString(template.id);
  addSortedStrings(hasher, template.tags);
  addSortedStrings(hasher, template.eraTags);
  addSortedStrings(hasher, template.techTags);
  for (const slot of template.memberSlotRules) {
    hasher.addString(slot.slotId);
    hasher.addString(slot.memberTemplateId);
    hasher.addNumber(slot.count);
    hasher.addNumber(slot.required ? 1 : 0);
  }
  hasher.addNumber(template.cohesionRadiusCells);
  hasher.addNumber(template.capturePowerScaleBps);
  hasher.addString(template.behaviorProfileId);
}

function hashMemberTemplate(hasher: StateHasher, template: MemberTemplate): void {
  hasher.addString(template.id);
  addSortedStrings(hasher, template.tags);
  addSortedStrings(hasher, template.eraTags);
  addSortedStrings(hasher, template.techTags);
  hasher.addString(template.movementType);
  hasher.addString(template.sensorTemplateId);
  for (const slot of template.weaponSlotRules) {
    hasher.addString(slot.slotId);
    hasher.addString(slot.weaponTemplateId);
    hasher.addNumber(slot.count);
    hasher.addNumber(slot.required ? 1 : 0);
  }
  addSortedStrings(hasher, template.roleTags);
  hasher.addString(template.silhouetteId);
  hasher.addNumber(template.protectionBps);
  hasher.addNumber(template.suppressionResistanceBps);
  hasher.addNumber(template.capturePowerBps);
}

function hashWeaponTemplate(hasher: StateHasher, template: WeaponTemplate): void {
  hasher.addString(template.id);
  addSortedStrings(hasher, template.tags);
  addSortedStrings(hasher, template.eraTags);
  addSortedStrings(hasher, template.techTags);
  addSortedStrings(hasher, template.targetDomains);
  hasher.addNumber(template.minimumRangeMm);
  hasher.addNumber(template.optimalRangeMm);
  hasher.addNumber(template.maximumRangeMm);
  hasher.addNumber(template.aimTicks);
  hasher.addNumber(template.magazineSize);
  hasher.addNumber(template.reloadTicks);
  hasher.addNumber(template.shotIntervalTicks);
  hasher.addString(template.firePattern.kind);
  hasher.addNumber(template.firePattern.shotsPerAction);
  hasher.addString(template.trajectory);
  for (const effect of template.damageEffects) {
    hashEffect(hasher, effect);
  }
  hasher.addNumber(template.suppressionBps);
  hasher.addNumber(template.exposureOnFireBps);
}

function hashEffect(hasher: StateHasher, effect: EffectDefinition): void {
  hasher.addString(effect.kind);
  hasher.addNumber(effect.amountBps);
}

function hashSensorTemplate(hasher: StateHasher, template: SensorTemplate): void {
  hasher.addString(template.id);
  hasher.addNumber(template.rangeMm);
  hasher.addNumber(template.acquisitionTicks);
  hasher.addNumber(template.contactForgetTicks);
  addSortedStrings(hasher, template.tags);
}

function hashSimpleTemplate(hasher: StateHasher, template: { readonly id: string; readonly tags: readonly string[] }): void {
  hasher.addString(template.id);
  addSortedStrings(hasher, template.tags);
}

function addStrings(hasher: StateHasher, values: readonly string[]): void {
  for (const value of values) {
    hasher.addString(value);
  }
}

function addSortedStrings(hasher: StateHasher, values: readonly string[]): void {
  addStrings(hasher, [...values].sort(compareStrings));
}

function cloneRecord<T>(record: Readonly<Record<string, T>>, clone: (value: T) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([id, value]) => [id, clone(value)]));
}

function cloneEraTemplate(template: EraTemplate): EraTemplate {
  return {
    ...template,
    tags: [...template.tags],
    allowedGroupTemplateIds: [...template.allowedGroupTemplateIds],
    allowedMemberTemplateIds: [...template.allowedMemberTemplateIds],
    allowedWeaponTemplateIds: [...template.allowedWeaponTemplateIds],
    allowedSensorTemplateIds: [...template.allowedSensorTemplateIds],
  };
}

function cloneGroupTemplate(template: GroupTemplate): GroupTemplate {
  return {
    ...template,
    tags: [...template.tags],
    eraTags: [...template.eraTags],
    techTags: [...template.techTags],
    memberSlotRules: template.memberSlotRules.map((slot) => ({ ...slot })),
    platformSlotRules: [...template.platformSlotRules],
  };
}

function cloneMemberTemplate(template: MemberTemplate): MemberTemplate {
  return {
    ...template,
    tags: [...template.tags],
    eraTags: [...template.eraTags],
    techTags: [...template.techTags],
    weaponSlotRules: template.weaponSlotRules.map((slot) => ({ ...slot })),
    roleTags: [...template.roleTags],
  };
}

function cloneWeaponTemplate(template: WeaponTemplate): WeaponTemplate {
  return {
    ...template,
    tags: [...template.tags],
    eraTags: [...template.eraTags],
    techTags: [...template.techTags],
    targetDomains: [...template.targetDomains],
    firePattern: { ...template.firePattern },
    damageEffects: template.damageEffects.map((effect) => ({ ...effect })),
  };
}

function cloneSensorTemplate(template: SensorTemplate): SensorTemplate {
  return { ...template, tags: [...template.tags] };
}

function cloneSimpleTemplate<T extends { readonly id: string; readonly tags: readonly string[] }>(template: T): T {
  return { ...template, tags: [...template.tags] };
}

function missingTemplate(namespace: string, id: string): never {
  throw new Error(`Unknown ${namespace} template: ${id}.`);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
