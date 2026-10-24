package apexmachines

import pronto "github.com/bonisoft3/pronto"

#Seats: {type: "array", maxItems: 2, items: {type: "string", maxLength: 1, values: ["a", "b"]}}
#Winner: {type: "string", maxLength: 4, values: ["", "a", "b", "draw"]}
// Frames to a car's goal from the start, or -1 where it reached none.
#Goal: {type: "integer", min: -1, max: 1000000}
// A milestone as a racer's race lifted it (pronto's kinetic-machine record):
// its frame and kind, the checksum of that frame, every frame's two bytes
// since the milestone before it, and for the finish its result.
#Lifted: {
	frame:    {type: "integer", min: 0, max: 1000000}
	kind:     {type: "string", maxLength: 12, values: ["grid", "start", "checkpoint", "time-over", "duel-finish"]}
	checksum: {type: "string", maxLength: 24}
	inputs:   {type: "string", maxLength: 16384}
	winner:   #Winner
	goal_a:   #Goal
	goal_b:   #Goal
}
#Duel: {
	stage: #Stage
	seed:  #Seed
	// Each side's session description, sent once its ICE gathering completes:
	// the challenger's offer and the target's answer.
	offer: {type: "string", maxLength: 8192}
	answer: {type: "string", maxLength: 8192}
	deadline: #Number
	// Each milestone joined under its frame and kind, with the seats that lifted it.
	lifts: {type: "array", maxItems: 8, items: {type: "object", fields: {#Lifted, by: #Seats}}}
	winner: #Winner
	goal_a: #Goal
	goal_b: #Goal
	// The frame and kind where the two racers' rows disagreed.
	dispute: {type: "string", maxLength: 24}
	// The seats a timeout found silent.
	silent: #Seats
}
// One duel: its two racers signal a data channel through it, race over the
// channel, and lift the race's milestones into it, which it joins and holds
// to each other; the finish both lifted alike is the result.
duel: pronto.#Machine & {
	config: {
		id:      "apexrun_duel"
		initial: "signalling"
		states: {
			signalling: {
				on: {
					describe: {guard: "mayDescribe", actions: "describe"}
					timeout: {guard: "isDue", target: "abandoned", actions: "timeout"}
				}
				always: {guard: "connected", target: "racing", actions: "race"}
			}
			racing: {
				on: {
					lift: {guard: "mayLift", actions: "lift"}
					timeout: {guard: "isDue", target: "abandoned", actions: "timeout"}
				}
				always: [{guard: "desynced", target: "disputed"}, {guard: "settled", target: "finished", actions: "decide"}]
			}
			for phase in ["finished", "disputed", "abandoned"] {
				(phase): type: "final"
			}
		}
	}
	setup: {
		version: 1
		guards: {
			mayDescribe: reads: ["actor"]
			mayLift: reads: ["actor", "payload.frame", "payload.kind"]
			isDue: reads: ["now"]
			for g in ["connected", "desynced", "settled"] {(g): reads: []}
		}
		actions: {
			describe: {reads: ["actor", "payload.description"], writes: ["offer", "answer"]}
			race: {reads: ["now"], writes: ["deadline"]}
			lift: {reads: ["actor", "now", "payload.frame", "payload.kind", "payload.checksum", "payload.inputs", "payload.winner", "payload.goal_a", "payload.goal_b"], writes: ["lifts", "dispute", "deadline"]}
			decide: {reads: [], writes: ["winner", "goal_a", "goal_b", "deadline"]}
			timeout: {reads: [], writes: ["silent", "deadline"]}
		}
		types: {
			context: {type: "object", fields: #Duel}
			// A racer's duel: the peer's description, whether its own is in,
			// the milestones lifted so far by whom, and how it ended.
			view: {type: "object", fields: {
				stage: #Stage, seed: #Seed, deadline: #Number
				peer: {type: "string", maxLength: 8192}
				described: {type: "boolean"}
				lifted: {type: "array", maxItems: 8, items: {type: "object", fields: {frame: #Lifted.frame, kind: #Lifted.kind, by: #Seats}}}
				winner: #Winner, goal_a: #Goal, goal_b: #Goal, dispute: {type: "string", maxLength: 24}, silent: #Seats
				phase: {type: "string", maxLength: 10, values: ["signalling", "racing", "finished", "disputed", "abandoned"]}
			}}
			events: {
				describe: {tier: "omnishell", payload: {type: "object", fields: description: {type: "string", maxLength: 8192}}}
				lift: {tier: "omnishell", payload: {type: "object", fields: #Lifted}}
				timeout: {tier: "mecha", payload: {type: "object", fields: {}}}
			}
		}
	}
}
