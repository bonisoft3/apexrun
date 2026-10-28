package apexrun

import (
	"list"

	pronto "github.com/bonisoft3/pronto"
	online "github.com/bonisoft3/apexrun/machines:apexmachines"
)

// What a reader reaches each Mecha machine through (pronto's mecha-surface.ts):
// seats and the public projection the machine writes, commands, admissions
// and leases the reader writes, each checked against its machine as the
// migration is written. A seat's columns past the protocol's are its view's
// fields of the same name, and a public row's are its projection's.
_reader: {name: "actor", type: "uuid", default: "auth_uid()"}
_outcome: [
	{ordinal: 6, name: "outcome", type: "text", required: false, cel: "this in ['', 'accepted', 'rejected']"},
	{ordinal: 7, name: "reason", type: "text", required: false, cel: "this.size() <= 64"},
]
_seat: {
	machine: _
	fields: [
		{ordinal: 1, name: "id", type: "text", pk: true, cel: "this.size() <= 64"},
		{ordinal: 2, name: "instance_id", type: "uuid"},
		{ordinal: 3, name: "actor", type: "uuid"},
		{ordinal: 4, name: "seat", type: "text", cel: "this.size() <= 16"},
		{ordinal: 5, name: "revision", type: "bigint"},
		{ordinal: 6, name: "phase", type: "text", cel: "this.size() <= 16"},
		{ordinal: 7, name: "view", type: "json", cel: (pronto.#ShapeCel & {shape: machine.setup.types.view}).out},
	]
}
_command: {
	machine: _
	fields: list.Concat([[
		// Derived by the reader from what it says: the instance, the revision it
		// was made at, the seat and the gesture, so the same gesture twice is one row.
		{ordinal: 1, name: "id", type: "text", pk: true, cel: "this.size() <= 128"},
		{ordinal: 2, name: "instance_id", type: "uuid"},
		_reader & {ordinal: 3},
		{ordinal: 4, name: "request", type: "json", cel: (pronto.#RequestCel & {events: [for ev, e in machine.setup.types.events if e.tier == "omnishell" {ev}]}).out},
		{ordinal: 5, name: "revision", type: "bigint", required: false},
	], _outcome])
}
_open: list.Concat([[
	{ordinal: 1, name: "id", type: "text", pk: true, cel: "this.size() <= 128"},
	{ordinal: 2, name: "instance_id", type: "uuid"},
	_reader & {ordinal: 3},
	{ordinal: 4, name: "kind", type: "text", cel: "this in ['create', 'join']"},
	// A create's shape is the machine's input, which no one cel states.
	{ordinal: 5, name: "input", type: "json"},
], _outcome])
_private: {durability: "live", access: {scope: "private", owner: "actor"}}

code: state: entities: {
	ApexrunPresenceSeat: _private
	ApexrunPresenceSeat: {
		id: "0xebfa4ed60fd5d64f"
		table: "apexrun_presence_seat"
		fields: list.Concat([(_seat & {machine: online.presence}).fields, [{ordinal: 8, name: "name", type: "text", required: false, cel: "this.size() <= 16"}]])
	}
	ApexrunPresenceCommand: _private
	ApexrunPresenceCommand: {
		id: "0xcdf55ec168b97d9c"
		table: "apexrun_presence_command"
		fields: (_command & {machine: online.presence}).fields
	}
	ApexrunPresencePublic: {
		id: "0x93c026e1862e2c67"
		table:      "apexrun_presence_public"
		durability: "live"
		access: scope: "public"
		fields: [
			{ordinal: 1, name: "id", type: "text", pk: true, cel: "this.size() <= 36"},
			{ordinal: 2, name: "name", type: "text", cel: "this.size() <= 16"},
		]
	}
	ApexrunPresenceLease: _private
	ApexrunPresenceLease: {
		id: "0xc4d6d832835cfe26"
		table: "apexrun_presence_lease"
		indexes: [{on: "actor"}]
		fields: [
			// One per tab, from the terminal's draw.
			{ordinal: 1, name: "id", type: "text", pk: true, cel: "this.size() == 36"},
			_reader & {ordinal: 2},
			// Bumped on the terminal's clock, which is what renews the lease.
			{ordinal: 3, name: "beat", type: "int", cel: "this >= 0"},
		]
	}
	ApexrunChallengeSeat: _private
	ApexrunChallengeSeat: {
		id: "0x95166b7168e7c797"
		table: "apexrun_challenge_seat"
		fields: list.Concat([(_seat & {machine: online.challenge}).fields, [
			{ordinal: 8, name: "inviter_name", type: "text", required: false, cel: "this.size() <= 16"},
			{ordinal: 9, name: "target_name", type: "text", required: false, cel: "this.size() <= 16"},
			{ordinal: 10, name: "stage", type: "text", required: false, cel: "this.size() <= 16"},
			{ordinal: 11, name: "duel", type: "text", required: false, cel: "this.size() <= 36"},
		]])
	}
	ApexrunChallengeCommand: _private
	ApexrunChallengeCommand: {
		id: "0x832f13adb3057bba"
		table: "apexrun_challenge_command"
		fields: (_command & {machine: online.challenge}).fields
	}
	ApexrunChallengeOpen: _private
	ApexrunChallengeOpen: {
		id: "0xdb31c593d68dc01e"
		table: "apexrun_challenge_open"
		fields: _open
	}
	ApexrunDuelSeat: _private
	ApexrunDuelSeat: {
		id: "0xdbf8bb586fc2ffbb"
		table: "apexrun_duel_seat"
		fields: list.Concat([(_seat & {machine: online.duel}).fields, [
			{ordinal: 8, name: "stage", type: "text", required: false, cel: "this.size() <= 16"},
			{ordinal: 9, name: "winner", type: "text", required: false, cel: "this.size() <= 4"},
		]])
	}
	ApexrunDuelCommand: _private
	ApexrunDuelCommand: {
		id: "0x85b89e1f36b95052"
		table: "apexrun_duel_command"
		fields: (_command & {machine: online.duel}).fields
	}
	ApexrunDuelOpen: _private
	ApexrunDuelOpen: {
		id: "0xc2f63d8e4a1b9075"
		table: "apexrun_duel_open"
		fields: _open
	}
}
