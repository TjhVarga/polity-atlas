const IPU_SOURCE_ID = 'ipu-parline';
const IPU_DATA_URL = 'https://data.ipu.org/';
const IPU_TERMS_URL = 'https://www.ipu.org/terms-use';

function isoDate(value) {
  return typeof value === 'string' && value ? value.slice(0, 10) : undefined;
}

function english(value) {
  if (typeof value === 'string') return value.trim() || undefined;
  return value?.en?.trim() || value?.fr?.trim() || undefined;
}

function currentSeries(field) {
  if (!Array.isArray(field)) return field;
  const open = field.filter((entry) => !entry.date_to);
  const candidates = open.length ? open : field;
  return [...candidates]
    .sort((left, right) =>
      String(left.date_from ?? '').localeCompare(String(right.date_from ?? '')),
    )
    .at(-1);
}

function fieldValue(field) {
  return currentSeries(field)?.value;
}

function numberValue(field) {
  const value = fieldValue(field);
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanValue(field) {
  const value = fieldValue(field);
  return typeof value === 'boolean' ? value : undefined;
}

function taxonomyMap(taxonomies) {
  const map = new Map();
  for (const taxonomy of taxonomies ?? []) {
    for (const term of taxonomy.terms ?? []) {
      map.set(`${taxonomy.key}:${term.key}`, english(term.value));
    }
  }
  return map;
}

function humanizeTerm(term) {
  return term
    ?.replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function termLabel(taxonomy, taxonomyKey, value) {
  const term = value?.term;
  if (!term) return undefined;
  return taxonomy.get(`${taxonomyKey}:${term}`) ?? humanizeTerm(term);
}

function electionDate(election) {
  return isoDate(election.attributes?.election_date?.value?.from);
}

function partyName(parties, partyId) {
  return english(parties.get(partyId)?.party_name) ?? humanizeTerm(partyId);
}

function normalizePartyResults(election, parties) {
  const results = election.attributes?.seats_per_parties?.value ?? [];
  return results
    .filter((result) => Number.isInteger(result.total_number_of_seats))
    .map((result) => ({
      partyId: result.party,
      party: partyName(parties, result.party),
      seats: result.total_number_of_seats,
    }))
    .sort(
      (left, right) =>
        right.seats - left.seats || left.party.localeCompare(right.party),
    );
}

function normalizeFullComposition(election, parties) {
  const results = election.attributes?.seats_per_parties?.value ?? [];
  if (!results.length) return undefined;

  const composition = results.map((result) => {
    const full = (result.vote_breakdown ?? []).find((breakdown) =>
      /full composition/i.test(english(breakdown.label) ?? ''),
    );
    if (!Number.isInteger(full?.value)) return undefined;
    return {
      partyId: result.party,
      party: partyName(parties, result.party),
      seats: full.value,
    };
  });

  if (composition.some((result) => result === undefined)) return undefined;
  return composition.sort(
    (left, right) =>
      right.seats - left.seats || left.party.localeCompare(right.party),
  );
}

function notePartyId(electionId, party, index) {
  const slug = party
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${electionId.toLowerCase()}-note-${slug || index + 1}`;
}

function normalizeFullCompositionNote(election, chamberSize) {
  const note = english(election.attributes?.elected_note?.value);
  if (!note) return undefined;

  const lines = note.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) =>
    /\bfull composition\b/i.test(line),
  );
  if (headingIndex === -1) return undefined;

  const composition = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (!line.trim()) continue;

    const match = line.match(/^\s*[-*\u2022]\s+(.+?)\s*:\s*(\d+)\s*$/);
    if (!match) {
      if (composition.length) break;
      continue;
    }

    const party = match[1].trim();
    composition.push({
      partyId: notePartyId(election.id, party, composition.length),
      party,
      seats: Number(match[2]),
    });
  }

  const reportedSeats = composition.reduce(
    (sum, result) => sum + result.seats,
    0,
  );
  if (!composition.length || reportedSeats !== chamberSize) return undefined;

  return composition.sort(
    (left, right) =>
      right.seats - left.seats || left.party.localeCompare(right.party),
  );
}

function electionScope(election, chamberSize) {
  const sourceTerm = election.attributes?.scope_of_elections?.value?.term;
  if (sourceTerm === 'full_renewal') return 'full-renewal';
  if (sourceTerm === 'partial_renewal') return 'partial-renewal';

  const seatsAtStake = election.attributes?.number_of_seats_at_stake?.value;
  if (Number.isInteger(seatsAtStake) && seatsAtStake > 0) {
    if (seatsAtStake === chamberSize) return 'full-renewal';
    if (seatsAtStake < chamberSize) return 'partial-renewal';
  }
  return 'unknown';
}

function normalizeLatestElection(elections, statutoryChamberSize, parties) {
  const latest = [...elections]
    .filter((election) => electionDate(election))
    .sort((left, right) =>
      electionDate(left).localeCompare(electionDate(right)),
    )
    .at(-1);
  if (!latest) return undefined;

  const scope = electionScope(latest, statutoryChamberSize);
  const seatsAtStake =
    latest.attributes?.number_of_seats_at_stake?.value || undefined;
  const seatsWonInElection = normalizePartyResults(latest, parties);
  let postElectionComposition =
    normalizeFullComposition(latest, parties) ??
    normalizeFullCompositionNote(latest, statutoryChamberSize);

  if (scope === 'full-renewal' && seatsWonInElection.length) {
    postElectionComposition ??= seatsWonInElection;
  }

  const postElectionSeats = postElectionComposition?.reduce(
    (sum, result) => sum + result.seats,
    0,
  );
  const chamberSize = Math.max(
    statutoryChamberSize,
    seatsAtStake ?? 0,
    postElectionSeats ?? 0,
  );

  const outcome = seatsWonInElection.length
    ? postElectionComposition
      ? {
          display: 'post-election-full-composition',
          seatsWonInElection,
          postElectionComposition,
        }
      : {
          display: 'contested-seats-only',
          seatsWonInElection,
        }
    : undefined;
  const notes = english(
    latest.attributes?.seats_per_parties?.annotation?.notes,
  );

  return {
    id: latest.id,
    ...(english(latest.attributes?.election_title?.value) && {
      title: english(latest.attributes.election_title.value),
    }),
    date: {
      from: electionDate(latest),
      ...(isoDate(latest.attributes?.election_date?.value?.to) && {
        to: isoDate(latest.attributes.election_date.value.to),
      }),
    },
    scope,
    ...(seatsAtStake && { seatsAtStake }),
    chamberSize,
    ...(outcome && { outcome }),
    ...(notes && { notes: [notes] }),
    sourceIds: [IPU_SOURCE_ID],
  };
}

function personName(person) {
  return [person?.first_name, person?.family_name]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function normalizeSpeakers(attributes, people, taxonomy) {
  const speakers = fieldValue(attributes.chamber_speakers) ?? [];
  const designationMode = termLabel(
    taxonomy,
    'speaker_designation_mode',
    fieldValue(attributes.speaker_designation_mode),
  );
  const designationAuthority = termLabel(
    taxonomy,
    'speaker_authority',
    fieldValue(attributes.speaker_authority),
  );
  const stateRank = termLabel(
    taxonomy,
    'state_rank',
    fieldValue(attributes.speaker_rank),
  );

  return speakers.map((speaker) => {
    const person = people.get(speaker.info);
    const term = speaker.term
      ? {
          ...(isoDate(speaker.term.from) && {
            from: isoDate(speaker.term.from),
          }),
          ...(isoDate(speaker.term.to) && { to: isoDate(speaker.term.to) }),
        }
      : undefined;
    const name = personName(person);

    return {
      ...(speaker.info && { personId: speaker.info }),
      ...(name && { name }),
      ...(english(speaker.official_title) && {
        officialTitle: english(speaker.official_title),
      }),
      acting: Boolean(speaker.is_acting),
      vacant: Boolean(speaker.vacant),
      ...(term && Object.keys(term).length && { term }),
      ...(english(speaker.additional_information) && {
        additionalInformation: english(speaker.additional_information),
      }),
      ...(designationMode && { designationMode }),
      ...(designationAuthority && { designationAuthority }),
      ...(stateRank && { stateRank }),
      ...(booleanValue(attributes.speaker_head_of_state) !== undefined && {
        becomesInterimHeadOfState: booleanValue(
          attributes.speaker_head_of_state,
        ),
      }),
      ...(booleanValue(attributes.speaker_mandate_continue) !== undefined && {
        mandateContinuesBetweenLegislatures: booleanValue(
          attributes.speaker_mandate_continue,
        ),
      }),
      sourceIds: [IPU_SOURCE_ID],
    };
  });
}

function normalizeElectoralSystem(attributes, parliamentAttributes, taxonomy) {
  const systemTerms =
    fieldValue(attributes.electoral_systems) ??
    [fieldValue(attributes.electoral_system)].filter(Boolean);
  const systems = systemTerms
    .map((term) => termLabel(taxonomy, 'electoral_system', term))
    .filter(Boolean);
  const subsystem = termLabel(
    taxonomy,
    'electoral_system',
    fieldValue(attributes.electoral_subsystem),
  );
  if (subsystem && !systems.includes(subsystem)) systems.push(subsystem);

  const directlyElectedSeats = numberValue(attributes.directly_elected_number);
  const notDirectlyElected = booleanValue(attributes.not_directly_elected);
  return {
    directlyElected:
      notDirectlyElected !== undefined
        ? !notDirectlyElected
        : Boolean(directlyElectedSeats),
    systems,
    ...(directlyElectedSeats !== undefined && { directlyElectedSeats }),
    ...(numberValue(attributes.indirectly_elected_number) !== undefined && {
      indirectlyElectedSeats: numberValue(attributes.indirectly_elected_number),
    }),
    ...(numberValue(attributes.appointed_members_number) !== undefined && {
      appointedSeats: numberValue(attributes.appointed_members_number),
    }),
    ...(numberValue(attributes.min_age_vote_elect) !== undefined && {
      votingAge: numberValue(attributes.min_age_vote_elect),
    }),
    ...(numberValue(attributes.min_age_member_parl) !== undefined && {
      eligibilityAge: numberValue(attributes.min_age_member_parl),
    }),
    ...(termLabel(
      taxonomy,
      'compulsory_voting',
      fieldValue(parliamentAttributes.compulsory_voting),
    ) && {
      compulsoryVoting: termLabel(
        taxonomy,
        'compulsory_voting',
        fieldValue(parliamentAttributes.compulsory_voting),
      ),
    }),
    sourceIds: [IPU_SOURCE_ID],
  };
}

function chamberKind(attributes, isUnicameral) {
  if (isUnicameral) return 'unicameral';
  const term = attributes.struct_parl_status?.value?.term;
  if (term === 'upper_chamber') return 'upper';
  return 'lower';
}

function eventType(chamber, scope) {
  if (scope === 'partial-renewal') return 'partial-renewal';
  if (scope === 'full-renewal') return 'full-renewal';
  if (!chamber.electoralSystem.directlyElected) {
    return chamber.electoralSystem.appointedSeats
      ? 'appointment-renewal'
      : 'indirect-renewal';
  }
  return 'other';
}

function expectedElections(chamber, elections, asOf) {
  const unique = new Map();
  for (const election of elections) {
    const expected = isoDate(
      election.attributes?.expect_date_next_election?.value,
    );
    if (!expected || expected < asOf) continue;
    const scope = electionScope(election, chamber.totalSeats);
    const id = `${chamber.id}:${expected}`;
    unique.set(id, {
      id,
      level: 'national',
      chamberId: chamber.id,
      chamberName: chamber.name,
      eventType: eventType(chamber, scope),
      status: 'expected',
      date: { from: expected },
      sourceIds: [IPU_SOURCE_ID],
    });
  }
  return [...unique.values()];
}

function sourceRecord(retrievedAt) {
  const monthYear = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(retrievedAt));
  return {
    id: IPU_SOURCE_ID,
    publisher: 'Inter-Parliamentary Union',
    title: 'Parline national parliament, chamber and election data',
    url: IPU_DATA_URL,
    retrievedAt,
    kind: 'intergovernmental',
    attribution: `Inter-Parliamentary Union: Parline, ${monthYear}`,
    termsUrl: IPU_TERMS_URL,
    license:
      'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International',
  };
}

function validateCountryJoin(snapshot) {
  const attributes = snapshot.country?.attributes ?? {};
  const expected = snapshot.requestedCountry;
  const actual = {
    iso2: attributes.country_code?.value,
    iso3: attributes.iso_alpha3?.value,
    m49: String(attributes.iso_numeric3?.value ?? '').padStart(3, '0'),
  };
  for (const key of ['iso2', 'iso3', 'm49']) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `IPU country join mismatch for ${expected.iso3}: expected ${key}=${expected[key]}, received ${actual[key]}`,
      );
    }
  }
}

export function normalizeIpuSnapshot(snapshot) {
  validateCountryJoin(snapshot);
  const taxonomy = taxonomyMap(snapshot.taxonomies);
  const parties = new Map(
    snapshot.parties.map((party) => [party.political_party_code, party]),
  );
  const people = new Map(
    snapshot.people.map((person) => [person.person_code, person]),
  );
  const parliamentEntity = snapshot.parliaments[0];
  if (!parliamentEntity) {
    throw new Error(
      `IPU returned no parliament for ${snapshot.requestedCountry.iso3}`,
    );
  }
  const parliamentAttributes = parliamentEntity.attributes ?? {};
  const structure = fieldValue(parliamentAttributes.structure_of_parliament);
  const isUnicameral =
    structure?.term === 'unicameral' || snapshot.chambers.length === 1;
  const asOf = isoDate(snapshot.retrievedAt);

  const chambers = snapshot.chambers
    .map((entity) => {
      const attributes = entity.attributes ?? {};
      const totalSeats =
        numberValue(attributes.statutory_members_number) ??
        numberValue(attributes.current_members_number);
      if (!totalSeats) {
        throw new Error(`IPU returned no chamber size for ${entity.id}`);
      }
      const chamber = {
        id: entity.id,
        name: english(fieldValue(attributes.chamber_name)) ?? entity.id,
        kind: chamberKind(attributes, isUnicameral),
        totalSeats,
        ...(numberValue(attributes.parliamentary_term) !== undefined && {
          parliamentaryTermYears: numberValue(attributes.parliamentary_term),
        }),
        ...(numberValue(attributes.frequency_renewal) !== undefined && {
          renewalFrequencyYears: numberValue(attributes.frequency_renewal),
        }),
        speakers: normalizeSpeakers(attributes, people, taxonomy),
        electoralSystem: normalizeElectoralSystem(
          attributes,
          parliamentAttributes,
          taxonomy,
        ),
        sourceIds: [IPU_SOURCE_ID],
      };
      const latestElection = normalizeLatestElection(
        snapshot.electionsByChamber[entity.id] ?? [],
        totalSeats,
        parties,
      );
      if (latestElection) chamber.latestElection = latestElection;
      return chamber;
    })
    .sort((left, right) => {
      const order = { lower: 0, unicameral: 0, upper: 1 };
      return (
        order[left.kind] - order[right.kind] || left.id.localeCompare(right.id)
      );
    });

  const upcoming = chambers
    .flatMap((chamber) =>
      expectedElections(
        chamber,
        snapshot.electionsByChamber[chamber.id] ?? [],
        asOf,
      ),
    )
    .sort(
      (left, right) =>
        left.date.from.localeCompare(right.date.from) ||
        left.chamberId.localeCompare(right.chamberId),
    );

  return {
    parliament: {
      name: {
        value:
          english(fieldValue(parliamentAttributes.parliament_name)) ??
          snapshot.requestedCountry.name,
        asOf,
        retrievedAt: snapshot.retrievedAt,
        sourceIds: [IPU_SOURCE_ID],
        confidence: 'verified',
      },
      chambers,
    },
    nextExpectedElections: upcoming,
    source: sourceRecord(snapshot.retrievedAt),
  };
}

function nonParliamentarySourceIds(profile) {
  return new Set([
    ...profile.government.system.sourceIds,
    ...profile.government.headOfState.flatMap((holder) => holder.sourceIds),
    ...profile.government.headOfGovernment.flatMap(
      (holder) => holder.sourceIds,
    ),
    ...profile.relations.flatMap((relation) => relation.sourceIds),
    ...(profile.territories ?? []).flatMap((territory) => territory.sourceIds),
  ]);
}

export function mergeIpuProfile(profile, normalized, buildId) {
  const retainedSourceIds = nonParliamentarySourceIds(profile);
  const retainedSources = profile.sources.filter((source) =>
    retainedSourceIds.has(source.id),
  );

  return {
    schemaVersion: 2,
    buildId,
    identity: profile.identity,
    government: profile.government,
    parliament: normalized.parliament,
    nextExpectedElections: normalized.nextExpectedElections,
    relations: profile.relations,
    ...(profile.territories && { territories: profile.territories }),
    sources: [...retainedSources, normalized.source].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
}
