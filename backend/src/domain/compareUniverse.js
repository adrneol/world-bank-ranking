/**
 * COMPARE COMPARISON UNIVERSE (pure, deterministic, no database access).
 *
 * ONE authoritative universe per comparison request. It is built from the
 * validated stored observations of the ELIGIBLE countries (the project's
 * universe rule: an entity flagged as an aggregate is never an eligible
 * country — domain/universe.js) for exactly the observation years the
 * selected analysis requires (domain/compareAnalysis.js).
 *
 * The universe has three nested sets, and they are never used
 * interchangeably:
 *
 *   CANDIDATES  eligible countries holding at least one valid observation in
 *               one of the required observation years. A country that holds
 *               nothing at all never enters the universe.
 *
 *   COMPLETE    candidates holding a valid observation at EVERY required
 *               observation year. This is the "complete universe" a
 *               like-for-like result is computed over: the completeness rule
 *               is identical for every entity and every period, and the set
 *               is FROZEN for the whole request.
 *
 *   REFERENCE   complete minus the comparison participants. It is the peer
 *               frame of the comparison: the entities under comparison are
 *               never part of the peer set, so a peer statistic can never
 *               double count a participant. The reference set is NEVER the
 *               basis of an entity's own value.
 *
 * The distinction between "the members used to compute an entity's own
 * value" and "the countries permitted in the peer/reference universe" is
 * preserved explicitly: a group's own value is computed over
 * (members AND complete), while the reference set excludes every
 * participant — group members included.
 *
 * Nothing here ever treats a missing observation as zero, never interpolates
 * and never substitutes one entity's value for another's.
 */

import { describeUniverseRule } from './universe.js';

/** Exclusion reasons recorded in the ledger. */
export const UNIVERSE_REASON_CODES = Object.freeze({
  COMPARISON_PARTICIPANT: 'comparison_participant',
  MISSING_REQUIRED_OBSERVATION: 'missing_required_observation',
});

/** Coverage basis recorded for every entity value. */
export const COVERAGE_BASIS = Object.freeze({
  /** The value is the sum/aggregate over the frozen complete universe. */
  COMMON_UNIVERSE: 'COMMON_UNIVERSE',
  /** The value is the entity's own single-country observation. */
  ENTITY_OWN_OBSERVATION: 'ENTITY_OWN_OBSERVATION',
  /** The value is the officially published World Bank aggregate. */
  WORLD_BANK_PUBLISHED: 'WORLD_BANK_PUBLISHED',
});

/**
 * Deterministic FNV-1a (32 bit) hash of a membership list.
 * The list is sorted first, so the hash depends on the SET and not on the
 * order in which the members were collected.
 *
 * @param {string[]} iso3List
 * @returns {string} e.g. "fnv1a32:1a2b3c4d"
 */
export function membershipHash(iso3List) {
  const sorted = [...iso3List].sort();
  let hash = 0x811c9dc5;
  const mix = (code) => {
    hash ^= code & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const iso3 of sorted) {
    for (let i = 0; i < iso3.length; i += 1) mix(iso3.charCodeAt(i));
    mix(0x2c); // ',' separator
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Build the frozen comparison universe.
 *
 * @param {object} input
 * @param {Map<number, Array<{iso3: string, value: number}>>} input.rowsByYear
 *        eligible observation rows per required observation year
 * @param {number[]} input.requiredObservationYears the years the selected
 *        analysis requires (already validated and sorted)
 * @param {Array<{iso3: string, role: string}>} input.participants
 *        comparison participants: selected country entities and every member
 *        of every selected custom group
 * @param {string} [input.mode] 'observed' | 'like_for_like'
 * @returns {object} the frozen universe
 */
export function buildCompareUniverse({ rowsByYear, requiredObservationYears, participants, mode = 'observed' } = {}) {
  const years = [...(requiredObservationYears ?? [])].filter((y) => Number.isInteger(y)).sort((a, b) => a - b);

  // Presence index: which required years each eligible country holds.
  const presentYears = new Map();
  for (const year of years) {
    for (const row of rowsByYear?.get(year) ?? []) {
      if (!row || typeof row.iso3 !== 'string' || !row.iso3) continue;
      if (!Number.isFinite(Number(row.value))) continue;
      if (!presentYears.has(row.iso3)) presentYears.set(row.iso3, new Set());
      presentYears.get(row.iso3).add(year);
    }
  }

  const candidates = [...presentYears.keys()].sort();
  const complete = candidates.filter((iso3) => presentYears.get(iso3).size === years.length);
  const completeSet = new Set(complete);

  // Participants: country entities AND every member of every custom group.
  const participantRole = new Map();
  for (const participant of participants ?? []) {
    if (!participant || typeof participant.iso3 !== 'string' || !participant.iso3) continue;
    const role = participant.role ?? 'entity';
    const existing = participantRole.get(participant.iso3);
    if (existing === undefined) participantRole.set(participant.iso3, role);
    else if (existing !== role) participantRole.set(participant.iso3, 'entity_and_group_member');
  }

  const reference = complete.filter((iso3) => !participantRole.has(iso3));

  // ---- exclusion ledger ---------------------------------------------------
  const excludedParticipants = [...participantRole.keys()].sort().map((iso3) => ({
    iso3,
    role: participantRole.get(iso3),
    inCompleteSet: completeSet.has(iso3),
  }));

  const excludedIncomplete = candidates
    .filter((iso3) => !completeSet.has(iso3))
    .map((iso3) => {
      const missingYears = years.filter((year) => !presentYears.get(iso3).has(year));
      return { iso3, missingYears, missingCount: missingYears.length };
    });

  // A country that is BOTH a participant and incomplete is listed once in the
  // distinct summary, with every applicable reason attached.
  const distinctMap = new Map();
  for (const entry of excludedParticipants) {
    distinctMap.set(entry.iso3, {
      iso3: entry.iso3,
      reasons: [UNIVERSE_REASON_CODES.COMPARISON_PARTICIPANT],
      missingYears: [],
    });
  }
  for (const entry of excludedIncomplete) {
    const existing = distinctMap.get(entry.iso3);
    if (existing) {
      existing.reasons.push(UNIVERSE_REASON_CODES.MISSING_REQUIRED_OBSERVATION);
      existing.missingYears = entry.missingYears;
    } else {
      distinctMap.set(entry.iso3, {
        iso3: entry.iso3,
        reasons: [UNIVERSE_REASON_CODES.MISSING_REQUIRED_OBSERVATION],
        missingYears: entry.missingYears,
      });
    }
  }
  const excludedDistinct = [...distinctMap.values()].sort((l, r) => (l.iso3 < r.iso3 ? -1 : l.iso3 > r.iso3 ? 1 : 0));

  // Every missing country/year pair, for the auditable missing-observation list.
  const missingObservations = [];
  for (const entry of excludedIncomplete) {
    for (const year of entry.missingYears) missingObservations.push({ iso3: entry.iso3, year });
  }

  return {
    mode,
    requiredObservationYears: years,
    candidates,
    candidateCount: candidates.length,
    complete,
    completeCount: complete.length,
    included: reference,
    includedCount: reference.length,
    membershipHash: membershipHash(reference),
    completeMembershipHash: membershipHash(complete),
    excluded: {
      participants: excludedParticipants,
      incomplete: excludedIncomplete,
      distinct: excludedDistinct,
    },
    counts: {
      candidates: candidates.length,
      complete: complete.length,
      reference: reference.length,
      excludedDistinct: excludedDistinct.length,
      excludedParticipants: excludedParticipants.length,
      excludedIncomplete: excludedIncomplete.length,
      missingObservations: missingObservations.length,
    },
    missingObservations,
    membershipRule: describeUniverseRule(),
  };
}

/**
 * Coverage of one entity against the frozen universe.
 *
 * For a custom group the value is computed over (members AND complete) —
 * the group's own complete members, drawn from the ONE frozen universe.
 * For a country the value is its own observation, which must exist at every
 * required observation year. For an official aggregate the value is the
 * published World Bank observation; its membership is NOT the common
 * universe and is recorded as such.
 *
 * @param {object} input
 * @param {string[]} input.members group members (empty for point entities)
 * @param {number[]} input.requiredObservationYears
 * @param {Map<number, Array<{iso3: string, value: number}>>} input.rowsByYear
 * @param {Set<string>} input.completeSet the frozen complete universe
 * @returns {object} coverage metadata
 */
export function buildEntityCoverage({ members = [], requiredObservationYears = [], rowsByYear, completeSet }) {
  const years = [...requiredObservationYears].filter((y) => Number.isInteger(y)).sort((a, b) => a - b);
  const validByYear = new Map();
  for (const year of years) {
    const valid = (rowsByYear?.get(year) ?? [])
      .filter((row) => row && typeof row.iso3 === 'string' && Number.isFinite(Number(row.value)))
      .map((row) => row.iso3)
      .sort();
    validByYear.set(year, valid);
  }

  const used = members.filter((iso3) => completeSet.has(iso3)).sort();
  const missingMembers = members.filter((iso3) => !completeSet.has(iso3)).sort();
  const perYear = {};
  for (const year of years) {
    const valid = validByYear.get(year) ?? [];
    const validSet = new Set(valid);
    const missing = members.filter((iso3) => !validSet.has(iso3)).sort();
    perYear[year] = {
      valid: members.filter((iso3) => validSet.has(iso3)).sort(),
      missing,
      validCount: members.length - missing.length,
      missingCount: missing.length,
    };
  }
  return {
    basis: COVERAGE_BASIS.COMMON_UNIVERSE,
    members: [...members].sort(),
    used,
    usedCount: used.length,
    complete: missingMembers.length === 0,
    missingMembers,
    byYear: perYear,
    missingYears: [],
  };
}

/**
 * Coverage of a POINT entity (one country, or one published aggregate)
 * against the required observation years.
 *
 * The entity's own observation must exist at EVERY required observation year
 * for a like-for-like result; the years it is missing are reported so a
 * blocked result can name them. An official aggregate keeps its published
 * World Bank semantics — the membership behind the published value is not
 * the common universe and is recorded as such.
 *
 * @param {object} input
 * @param {string} input.iso3
 * @param {number[]} input.requiredObservationYears
 * @param {Map<number, number|null>} input.valuesByYear
 * @param {string} input.basis COVERAGE_BASIS value
 * @returns {object} coverage metadata
 */
export function buildPointCoverage({ iso3, requiredObservationYears = [], valuesByYear, basis }) {
  const years = [...requiredObservationYears].filter((y) => Number.isInteger(y)).sort((a, b) => a - b);
  const perYear = {};
  const missingYears = [];
  for (const year of years) {
    const raw = valuesByYear?.get(year);
    // The stored entry may be the raw number or the full observation record.
    const value = raw && typeof raw === 'object' ? raw.value : raw;
    const available = value !== null && value !== undefined && Number.isFinite(Number(value));
    perYear[year] = { available, value: available ? Number(value) : null };
    if (!available) missingYears.push(year);
  }
  return {
    basis,
    iso3,
    used: missingYears.length === 0 ? [iso3] : [],
    usedCount: missingYears.length === 0 ? 1 : 0,
    complete: missingYears.length === 0,
    byYear: perYear,
    missingYears,
  };
}

export default {
  UNIVERSE_REASON_CODES,
  COVERAGE_BASIS,
  membershipHash,
  buildCompareUniverse,
  buildEntityCoverage,
  buildPointCoverage,
};
