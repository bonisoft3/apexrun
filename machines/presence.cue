package apexmachines

import pronto "github.com/bonisoft3/pronto"

#Identity: {type: "string", maxLength: 36}
#Number: {type: "integer", min: 0, max: 9007199254740991}
#Presence: {
	name: {type: "string", maxLength: 16}
	leases: {type: "array", maxItems: 16, items: {type: "object", fields: {id: #Identity, until: #Number}}}
	// When the earliest lease lapses, or 0 with none: the ticker's deadline.
	until: #Number
}
// Who is in the lobby: an account's visibility, and a lease per open tab.
presence: pronto.#Machine & {
	config: {
		id:      "apexrun_presence"
		initial: "hidden"
		on: {
			show: {guard: "mayShow", target: "visible", actions: "show"}
			hide: {target: "hidden"}
			touch: {guard: "hasCapacity", actions: "touch"}
			leave: {actions: "leave"}
			expire: {actions: "expire"}
		}
		states: {hidden: {}, visible: {}}
	}
	setup: {
		guards: {
			mayShow: reads: ["now", "payload.name"]
			hasCapacity: reads: ["now", "payload.session"]
		}
		actions: {
			show: {reads: ["payload.name"], writes: ["name"]}
			touch: {reads: ["now", "payload.session"], writes: ["leases", "until"]}
			leave: {reads: ["now", "payload.session"], writes: ["leases", "until"]}
			expire: {reads: ["now"], writes: ["leases", "until"]}
		}
		version: 1
		types: {
			context: {type: "object", fields: #Presence}
			view: {type: "object", fields: {#Presence, phase: {type: "string", maxLength: 7, values: ["hidden", "visible"]}}}
			// Who the lobby lists: a visible racer with a tab still open.
			public: {type: "object", fields: {name: {type: "string", maxLength: 16}}}
			events: {
				show: {tier: "omnishell", payload: {type: "object", fields: {name: {type: "string", maxLength: 16}}}}
				hide: {tier: "omnishell", payload: {type: "object", fields: {}}}
				touch: {tier: "mecha", payload: {type: "object", fields: {session: #Identity}}}
				leave: {tier: "mecha", payload: {type: "object", fields: {session: #Identity}}}
				expire: {tier: "mecha", payload: {type: "object", fields: {}}}
			}
		}
	}
}
