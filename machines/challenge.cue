package apexmachines

import pronto "github.com/bonisoft3/pronto"

// The stages a duel races: the road's ten, never a destination's run-out
// (shell/engine/simulation.js OUTRUN_STAGES).
#Stage: {type: "string", maxLength: 16, values: [
	"coconut-beach", "desert-canyons", "gateway-pass", "alpine-peaks", "wilderness-run",
	"tulip-gardens", "sunset-highway", "ancient-ruins", "metropolis-night", "coastal-cliffs",
]}
// A race's seed, as the run row holds one (an int32 the engine is handed).
#Seed: {type: "integer", min: 0, max: 2147483647}
#Challenge: {
	inviter: #Identity
	target:  #Identity
	inviter_name: {type: "string", maxLength: 16}
	target_name: {type: "string", maxLength: 16}
	// The challenger's pick, and their draw the duel is raced from.
	stage:    #Stage
	seed:     #Seed
	deadline: #Number
	duel:     #Identity
}
challenge: pronto.#Machine & {
	config: {
		id:      "apexrun_challenge"
		initial: "offered"
		states: {
			offered: on: {
				accept: {guard: "mayAccept", target: "accepted", actions: "openDuel"}
				decline: {guard: "mayAnswer", target: "declined"}
				cancel: {guard: "mayCancel", target: "cancelled"}
				expire: {guard: "isDue", target: "expired"}
			}
			for phase in ["accepted", "declined", "cancelled", "expired"] {
				(phase): type: "final"
			}
		}
	}
	setup: {
		version: 1
		locks: [{when: "tier = 'omnishell'", schema: "hybrid_apexrun_presence", table: "instance", key: "id", values: [
			{raw: "(game.state->>'inviter')::uuid"}, {raw: "(game.state->>'target')::uuid"},
		]}]
		types: {
			context: {type: "object", fields: #Challenge}
			view: {type: "object", fields: {#Challenge, phase: {type: "string", maxLength: 9, values: ["offered", "accepted", "declined", "cancelled", "expired"]}}}
			events: {
				for event in ["accept", "decline", "cancel"] {
					(event): {tier: "omnishell", payload: {type: "object", fields: {}}}
				}
				expire: {tier: "mecha", payload: {type: "object", fields: {}}}
			}
		}
		guards: {
			mayAnswer: reads: ["actor", "now"]
			mayCancel: reads: ["actor", "now"]
			isDue: reads: ["now"]
		}
		// The target's answer, and both racers still free when it is given.
		guards: mayAccept: {
			rules:  "mayAnswer"
			reads: ["actor", "now"]
			sql:    "hybrid_apexrun_presence.available((game.state->>'inviter')::uuid) AND hybrid_apexrun_presence.available((game.state->>'target')::uuid)"
			reason: "racer_unavailable"
		}
		// The duel the accepted challenge opens, its challenger in seat a.
		actions: openDuel: [
			{spawn: {machine: "apexrun_duel", id: {raw: "(game.state->>'duel')::uuid"},
				input: {stage: {raw: "game.state->>'stage'"}, seed: {raw: "(game.state->>'seed')::bigint"}},
				members: {a: {raw: "game.state->>'inviter'"}, b: {raw: "game.state->>'target'"}}}},
			{send: {machine: "apexrun_duel", id: {raw: "(game.state->>'duel')::uuid"}, event: "start", payload: seats: ["a", "b"]}},
		]
	}
}
