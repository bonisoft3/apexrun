package apexmachines

import "strings"

challenge: setup: {
	initialize: "initial"
	types: input: {type: "object", fields: {
		inviter: #Identity, target: #Identity, duel: #Identity, stage: #Stage, seed: #Seed
		inviter_name: {type: "string", maxLength: 16}, target_name: {type: "string", maxLength: 16}
	}}
	ports: {
		admission: {
			name: "apexrun_challenge_offer"
			params: [{name: "challenge_id", type: "uuid"}, {name: "target", type: "uuid"}, {name: "stage", type: "text"}, {name: "seed", type: "text"}]
			id: "challenge_id"
			locks: [{schema: "hybrid_apexrun_presence", table: "instance", key: "id", values: [{raw: "current_actor"}, {raw: "target"}]}]
			checks: [
				{sql: "target IS NOT NULL AND current_actor <> target", reason: "invalid challenge racers", mode: "error"},
				{sql: "seed ~ '^[0-9]{1,10}$' AND seed::bigint <= 2147483647", reason: "invalid duel seed", mode: "error"},
				{sql: "stage IN (\(_stages))", reason: "unknown duel stage", mode: "error"},
				{sql: "NOT EXISTS (SELECT FROM hybrid_apexrun_challenge.instance c WHERE c.state->>'phase' = 'offered' AND (c.state->>'deadline')::bigint > hybrid_apexrun_challenge.clock() AND c.state->>'inviter' = current_actor::text)", reason: "outgoing_challenge_pending"},
				{sql: "hybrid_apexrun_presence.available(current_actor) AND hybrid_apexrun_presence.available(target)", reason: "racer_unavailable"},
			]
			input: {
				inviter: {raw: "current_actor"}, target: {raw: "target"}, stage: {raw: "stage"}, seed: {raw: "seed::bigint"}
				duel: {raw: "md5('apexrun_duel/' || challenge_id::text)::uuid"}
				inviter_name: {raw: "(SELECT state->>'name' FROM hybrid_apexrun_presence.instance WHERE id = current_actor)"}
				target_name: {raw: "(SELECT state->>'name' FROM hybrid_apexrun_presence.instance WHERE id = target)"}
			}
			members: {inviter: {raw: "current_actor"}, target: {raw: "target"}}
		}
		wake: {phases: ["offered"], deadline: "deadline", event: "expire"}
	}
}
_stages: strings.Join([for s in #Stage.values {"'\(s)'"}], ", ")

presence: setup: {
	initialize: "initial"
	types: input: {type: "object", fields: {}}
	ports: {
		admission: {name: "admit", params: [], id: "current_actor", input: {}, members: owner: {raw: "current_actor"}}
		// A lapsed lease is dropped by the ticker, so the lobby stops listing a
		// racer whose tabs all went away without leaving.
		wake: {phases: ["visible"], deadline: "until", event: "expire"}
		lease: {touch: "touch", leave: "leave", held: "leases"}
		reads: available: {
			params: [{name: "racer", type: "uuid"}]
			returns: "boolean"
			sql: """
				SELECT EXISTS (SELECT FROM hybrid_apexrun_presence.instance p
				  WHERE p.id = racer AND p.state->>'phase' = 'visible'
				  AND EXISTS (SELECT FROM jsonb_array_elements(p.state->'leases') l
				    WHERE (l->>'until')::bigint > hybrid_apexrun_presence.clock()))
				  AND NOT EXISTS (SELECT FROM hybrid_apexrun_duel.member m JOIN hybrid_apexrun_duel.instance d ON d.id = m.instance_id
				    WHERE m.actor = racer AND d.state->>'phase' IN ('waiting', 'signalling', 'racing'));
				"""
		}
	}
}

duel: setup: {
	initialize: "initial"
	types: input: {type: "object", fields: {stage: #Stage, seed: #Seed}}
	ports: {
		// A challenge link opens a duel in `waiting` with the opener in seat a;
		// the second racer joins seat b, which delivers `start`.
		admission: {
			name: "apexrun_duel_create"
			params: [{name: "instance_id", type: "uuid"}, {name: "stage", type: "text"}, {name: "seed", type: "text"}]
			id: "instance_id"
			locks: [{schema: "hybrid_apexrun_presence", table: "instance", key: "id", values: [{raw: "current_actor"}]}]
			checks: [
				{sql: "seed ~ '^[0-9]{1,10}$' AND seed::bigint <= 2147483647", reason: "invalid duel seed", mode: "error"},
				{sql: "stage IN (\(_stages))", reason: "unknown duel stage", mode: "error"},
				{sql: "NOT EXISTS (SELECT FROM hybrid_apexrun_duel.member m JOIN hybrid_apexrun_duel.instance d ON d.id = m.instance_id WHERE m.actor = current_actor AND d.state->>'phase' IN ('waiting', 'signalling', 'racing'))", reason: "racer_unavailable"},
			]
			input: {stage: {raw: "stage"}, seed: {raw: "seed::bigint"}}
			members: a: {raw: "current_actor"}
		}
		join: {seats: "seats", membersPayload: "seats", phases: ["waiting"], event: "start"}
		// A racer silent past the phase's deadline is the ticker's to time out.
		wake: {phases: ["waiting", "signalling", "racing"], deadline: "deadline", event: "timeout"}
	}
}
