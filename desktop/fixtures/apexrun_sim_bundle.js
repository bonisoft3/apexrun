(() => {
  // apps/apexrun/shell/engine/prng.js
  function prngStep(seed) {
    const a = seed + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return [
      ((t ^ t >>> 14) >>> 0) / 4294967296,
      a
    ];
  }
  function createPrng(seed) {
    let s = seed | 0;
    return function next() {
      const [v, nextSeed] = prngStep(s);
      s = nextSeed;
      return v;
    };
  }

  // apps/apexrun/shell/engine/stage_look.js
  var SHORE = 30;
  var BOAT_CLEARANCE = 10;
  var DRY_TERRAIN_OFFSETS = [
    0,
    5.5,
    10,
    15,
    21,
    28,
    37,
    48,
    62,
    80,
    105,
    140,
    185,
    250,
    330,
    440,
    580,
    780,
    1060,
    1400
  ];
  var WET_TERRAIN_OFFSETS = [
    0,
    5.5,
    10,
    15,
    22,
    SHORE
  ];
  var WATER_OFFSETS = [
    -2,
    1,
    4,
    8,
    14,
    22,
    32,
    46,
    68,
    100,
    160,
    280,
    560,
    1400
  ];
  var STAGE_TERRAIN_PROFILES = {
    // Coastal beaches & marinas: gentle wind-sculpted sand dunes & palm-fringed lagoon swales (no mountains on the coast!)
    "coconut-beach": {
      nearAmp: 1.1,
      midAmp: 2.1,
      ridgeBias: 0.35,
      freqZ: 3e-3,
      freqOff: 75e-4
    },
    "destination-marina": {
      nearAmp: 0.9,
      midAmp: 1.8,
      ridgeBias: 0.3,
      freqZ: 28e-4,
      freqOff: 7e-3
    },
    // Dutch polder, urban boulevard & airfield: wide flat meadows & low canal dike berms
    "tulip-gardens": {
      nearAmp: 0.6,
      midAmp: 1.3,
      ridgeBias: 0.25,
      freqZ: 26e-4,
      freqOff: 6e-3
    },
    "metropolis-night": {
      nearAmp: 0.4,
      midAmp: 0.9,
      ridgeBias: 0.15,
      freqZ: 25e-4,
      freqOff: 55e-4
    },
    "destination-aerodrome": {
      nearAmp: 0.7,
      midAmp: 1.4,
      ridgeBias: 0.25,
      freqZ: 26e-4,
      freqOff: 6e-3
    },
    // Desert ergs & canyon bajadas: long, sweeping wind-blown barchan dune swells around flat valley floors
    "desert-canyons": {
      nearAmp: 1.8,
      midAmp: 4.8,
      ridgeBias: 1.2,
      freqZ: 3e-3,
      freqOff: 72e-4
    },
    "sunset-highway": {
      nearAmp: 1.5,
      midAmp: 4,
      ridgeBias: 1,
      freqZ: 28e-4,
      freqOff: 68e-4
    },
    "destination-oasis": {
      nearAmp: 1.9,
      midAmp: 4.6,
      ridgeBias: 1.1,
      freqZ: 31e-4,
      freqOff: 74e-4
    },
    // Tuscan, Mediterranean & forest stages: long, soft C2 rolling pastoral downs (300m+ wavelength, zero spiky facets)
    "gateway-pass": {
      nearAmp: 2.2,
      midAmp: 6.2,
      ridgeBias: 1.8,
      freqZ: 31e-4,
      freqOff: 7e-3
    },
    "wilderness-run": {
      nearAmp: 1.9,
      midAmp: 5.4,
      ridgeBias: 1.5,
      freqZ: 32e-4,
      freqOff: 72e-4
    },
    "ancient-ruins": {
      nearAmp: 1.8,
      midAmp: 5,
      ridgeBias: 1.4,
      freqZ: 3e-3,
      freqOff: 68e-4
    },
    "destination-castle": {
      nearAmp: 2.1,
      midAmp: 5.8,
      ridgeBias: 1.7,
      freqZ: 31e-4,
      freqOff: 7e-3
    },
    "destination-colosseum": {
      nearAmp: 1.6,
      midAmp: 4.4,
      ridgeBias: 1.2,
      freqZ: 29e-4,
      freqOff: 66e-4
    },
    // High alpine valleys & coastal headlands: smooth sweeping glacial moraines & clifftop downs
    "alpine-peaks": {
      nearAmp: 2.5,
      midAmp: 7.4,
      ridgeBias: 2.4,
      freqZ: 32e-4,
      freqOff: 72e-4
    },
    "coastal-cliffs": {
      nearAmp: 2.3,
      midAmp: 6.6,
      ridgeBias: 2.1,
      freqZ: 31e-4,
      freqOff: 7e-3
    }
  };
  function smoothstep01(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function terrainHeightAt(stageId, p, baseY, waterY, side, offset, isWetSide, zEnd = Infinity) {
    const roadShoulderY = p.y - 0.05;
    if (isWetSide) {
      if (offset >= SHORE) return waterY;
      if (offset <= 5.5) return roadShoulderY;
      if (offset <= 16) {
        const dunePhase = Math.sin(p.z * 85e-4 + side * 1.3) * 0.6 + Math.cos(p.z * 0.019 - offset * 0.09) * 0.4;
        const dune = Math.sin((offset - 5.5) / 10.5 * Math.PI) * (0.42 + 0.28 * dunePhase);
        return roadShoulderY + dune;
      }
      const t = Math.max(0, Math.min(1, (offset - 16) / Math.max(1, SHORE - 16)));
      const smoothT = t * t * (3 - 2 * t);
      return roadShoulderY + (waterY - roadShoulderY) * smoothT;
    }
    const macroY = offset <= 32 ? roadShoulderY : p.y + (baseY - p.y) * Math.min(1, (offset - 32) / 380);
    if (offset <= 5.5 || offset >= 600) return macroY;
    const prof = STAGE_TERRAIN_PROFILES[stageId] ?? STAGE_TERRAIN_PROFILES["coconut-beach"];
    const hasDest = Boolean(STAGE_LOOKS[stageId]?.destination);
    const endFade = hasDest && Number.isFinite(zEnd) ? 1 - smoothstep01(zEnd - 120, zEnd - 15, p.z) : 1;
    if (endFade <= 0) return macroY;
    const nearEnv = smoothstep01(5.5, 24, offset) * (1 - smoothstep01(55, 145, offset));
    const midEnv = smoothstep01(18, 85, offset) * (1 - smoothstep01(260, 580, offset));
    const phaseSide = side < 0 ? 0 : 2.17;
    const z = p.z;
    const w1 = Math.sin(z * prof.freqZ + offset * prof.freqOff + phaseSide);
    const w2 = Math.cos(z * (prof.freqZ * 1.62) - offset * (prof.freqOff * 0.85) + phaseSide * 1.4);
    const w3 = Math.sin(z * (prof.freqZ * 0.53) + offset * 45e-4 - phaseSide);
    const wave = 0.52 * w1 + 0.3 * w2 + 0.18 * w3;
    const nearRelief = prof.nearAmp * (0.35 + 0.65 * w1) * nearEnv;
    const midRelief = (prof.ridgeBias * (0.5 + 0.5 * w3) + prof.midAmp * wave) * midEnv;
    return macroY + (nearRelief + midRelief) * endFade;
  }
  var ORIENTED = /* @__PURE__ */ new Set([
    "arch",
    "powerPole",
    "streetLamp",
    "hangar",
    "colosseum",
    "lighthouse",
    "tower",
    "rockArch",
    "seaArch",
    "chapelAlpine",
    "chapelTuscan",
    "clockTower",
    "kasbah",
    "aqueduct",
    "spire"
  ]);
  var PROP_FOOTPRINT = {
    mesa: 20,
    cliff: 16,
    colosseum: 90,
    hangar: 20,
    tower: 13,
    castleTower: 6,
    lighthouse: 4,
    rockArch: 30,
    seaArch: 6,
    chapelAlpine: 14,
    chapelTuscan: 14,
    clockTower: 14,
    kasbah: 14,
    aqueduct: 40,
    spire: 14,
    butte: 20,
    greatTree: 8,
    greatWindmill: 6
  };
  var PROP_RADIUS = {
    palm: 0.5,
    cactus: 0.45,
    cypress: 0.7,
    pine: 1,
    broadleaf: 1,
    column: 0.7,
    brokenArch: 1.5,
    rock: 1.3,
    cliff: 18,
    mesa: 20,
    windmill: 2.2,
    powerPole: 0.35,
    streetLamp: 0.3,
    tower: 9,
    lighthouse: 2.5,
    castleTower: 8,
    runwayLight: 0.2,
    hangar: 12,
    colosseum: 75,
    turbine: 1.2,
    rockArch: 28,
    seaArch: 10,
    chapelAlpine: 14,
    chapelTuscan: 14,
    clockTower: 14,
    kasbah: 14,
    aqueduct: 6,
    spire: 14,
    butte: 20,
    greatTree: 3,
    greatWindmill: 4
  };
  var atSegment = (at, count) => Math.max(2, Math.ceil(at * count));
  function heroSegment(stageId, count) {
    return atSegment(STAGE_LOOKS[stageId].props.find((spec) => spec.landmark).at, count);
  }
  function placeProps(stageId, count, forkStart) {
    const look = STAGE_LOOKS[stageId];
    const seed = [
      ...stageId
    ].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
    const out = [];
    look.props.forEach((spec, k) => {
      const rand = createPrng(seed + k * 7919);
      const sides = spec.side === "both" ? [
        -1,
        1
      ] : spec.side === "left" ? [
        -1
      ] : spec.side === "right" ? [
        1
      ] : [
        0
      ];
      const [from, to] = spec.at !== void 0 ? [
        spec.at,
        spec.at
      ] : spec.zone ?? [
        0,
        1
      ];
      const once = spec.at !== void 0;
      for (let i = atSegment(from, count); once ? i === atSegment(from, count) : i < Math.min(count - 2, to * count); i += spec.every ?? 1) {
        if (spec.side === "over" && i >= forkStart) break;
        for (const side of sides) {
          const wet = look.water && side !== 0 && look.water.side === "left" === side < 0;
          if (spec.kind === "sailboat" && !wet) continue;
          const near = spec.kind === "sailboat" ? Math.max(spec.near, SHORE + BOAT_CLEARANCE) : spec.near;
          const offset = near + rand() * (spec.far - near);
          const scale = spec.scale[0] + rand() * (spec.scale[1] - spec.scale[0]);
          const yaw = ORIENTED.has(spec.kind) ? null : rand() * Math.PI * 2;
          if (wet && spec.kind !== "sailboat" && offset > SHORE - 4) continue;
          out.push({
            kind: spec.kind,
            k,
            i,
            side,
            offset,
            scale,
            yaw,
            ...spec.landmark ? {
              landmark: true
            } : {}
          });
        }
      }
    });
    return out;
  }
  var STAGE_LOOKS = {
    "coconut-beach": {
      sun: {
        color: "#FFF0C4",
        elevation: 0.05,
        azimuth: 0.1
      },
      light: {
        ground: "#6B4A3A"
      },
      fog: {
        density: 16e-4
      },
      ground: "#C9A57A",
      water: {
        side: "left",
        color: "#1F5F80"
      },
      props: [
        // Palm avenue, open beach with sea views, the marina, the headland.
        {
          kind: "palm",
          side: "both",
          every: 1,
          near: 2,
          far: 6,
          scale: [
            1,
            1.3
          ],
          zone: [
            0,
            0.3
          ]
        },
        {
          kind: "grassTuft",
          side: "both",
          every: 1,
          near: 1,
          far: 30,
          scale: [
            0.8,
            1.5
          ],
          zone: [
            0,
            0.55
          ]
        },
        {
          kind: "palm",
          side: "both",
          every: 6,
          near: 6,
          far: 30,
          scale: [
            0.85,
            1.3
          ],
          zone: [
            0.3,
            0.55
          ]
        },
        {
          kind: "shrub",
          side: "both",
          every: 4,
          near: 6,
          far: 40,
          scale: [
            0.7,
            1.4
          ],
          zone: [
            0.3,
            0.55
          ]
        },
        {
          kind: "sailboat",
          side: "left",
          every: 7,
          near: 40,
          far: 160,
          scale: [
            0.8,
            1.4
          ],
          zone: [
            0.55,
            0.8
          ]
        },
        {
          kind: "palm",
          side: "right",
          every: 3,
          near: 3,
          far: 10,
          scale: [
            0.9,
            1.2
          ],
          zone: [
            0.55,
            0.8
          ]
        },
        // The hero landmark: the lighthouse on the marina's point.
        {
          kind: "lighthouse",
          side: "right",
          at: 0.7,
          near: 30,
          far: 30,
          scale: [
            1.5,
            1.5
          ],
          landmark: true
        },
        {
          kind: "cliff",
          side: "right",
          every: 3,
          near: 30,
          far: 60,
          scale: [
            0.8,
            1.4
          ],
          zone: [
            0.8,
            1
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 2,
          near: 4.5,
          far: 40,
          scale: [
            0.8,
            2.4
          ],
          zone: [
            0.8,
            1
          ]
        },
        {
          kind: "grassTuft",
          side: "both",
          every: 2,
          near: 1,
          far: 20,
          scale: [
            0.8,
            1.3
          ],
          zone: [
            0.8,
            1
          ]
        }
      ]
    },
    "desert-canyons": {
      sun: {
        color: "#FFF7DE",
        elevation: 0.45,
        azimuth: -0.5
      },
      light: {
        ground: "#A0522D"
      },
      fog: {
        density: 12e-4
      },
      ground: "#D9A066",
      water: null,
      props: [
        // Cactus plain, the canyon with mesas close by, the wide mesa valley.
        {
          kind: "cactus",
          side: "both",
          every: 1,
          near: 4,
          far: 30,
          scale: [
            0.8,
            1.3
          ],
          zone: [
            0,
            1
          ]
        },
        {
          kind: "shrub",
          side: "both",
          every: 3,
          near: 4,
          far: 50,
          scale: [
            0.4,
            0.9
          ],
          zone: [
            0,
            0.3
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 10,
          near: 6,
          far: 70,
          scale: [
            0.5,
            1.1
          ],
          zone: [
            0,
            0.3
          ]
        },
        {
          kind: "mesa",
          side: "both",
          every: 7,
          near: 38,
          far: 110,
          scale: [
            0.9,
            1.3
          ],
          zone: [
            0.3,
            0.65
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 4,
          near: 6,
          far: 50,
          scale: [
            0.5,
            1.2
          ],
          zone: [
            0.3,
            0.65
          ]
        },
        {
          kind: "mesa",
          side: "both",
          every: 9,
          near: 160,
          far: 380,
          scale: [
            1.2,
            2
          ],
          zone: [
            0.65,
            1
          ]
        },
        // The hero landmark: the great rock arch over the canyon's end.
        {
          kind: "rockArch",
          side: "right",
          at: 0.62,
          near: 90,
          far: 90,
          scale: [
            1.5,
            1.5
          ],
          landmark: true
        },
        {
          kind: "rock",
          side: "both",
          every: 8,
          near: 6,
          far: 70,
          scale: [
            0.5,
            1.2
          ],
          zone: [
            0.65,
            1
          ]
        }
      ]
    },
    "gateway-pass": {
      sun: {
        color: "#FFC6A4",
        elevation: 0.02,
        azimuth: 0
      },
      light: {
        ground: "#2A2035"
      },
      fog: {
        density: 18e-4
      },
      ground: "#4B3B55",
      water: null,
      props: [
        // Cypress avenue under the arches, open hills, the rocky pass.
        {
          kind: "arch",
          side: "over",
          every: 30,
          near: 2,
          far: 2,
          scale: [
            1,
            1
          ],
          zone: [
            0,
            0.35
          ]
        },
        {
          kind: "cypress",
          side: "both",
          every: 2,
          near: 5,
          far: 9,
          scale: [
            0.9,
            1.3
          ],
          zone: [
            0,
            0.35
          ]
        },
        {
          kind: "grassTuft",
          side: "both",
          every: 1,
          near: 1,
          far: 30,
          scale: [
            0.8,
            1.4
          ],
          zone: [
            0,
            0.7
          ]
        },
        {
          kind: "cypress",
          side: "both",
          every: 6,
          near: 8,
          far: 40,
          scale: [
            0.8,
            1.3
          ],
          zone: [
            0.35,
            0.7
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 4,
          near: 5,
          far: 60,
          scale: [
            0.6,
            1.6
          ],
          zone: [
            0.35,
            0.7
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 1,
          near: 4.9,
          far: 30,
          scale: [
            0.8,
            2.6
          ],
          zone: [
            0.7,
            1
          ]
        },
        {
          kind: "cypress",
          side: "both",
          every: 5,
          near: 7,
          far: 18,
          scale: [
            0.8,
            1.1
          ],
          zone: [
            0.7,
            1
          ]
        },
        // The hero landmark: a chapel and campanile on a knoll over the open hills.
        {
          kind: "chapelTuscan",
          side: "left",
          at: 0.52,
          near: 60,
          far: 60,
          scale: [
            1,
            1
          ],
          landmark: true
        }
      ]
    },
    "alpine-peaks": {
      sun: {
        color: "#FFFFFF",
        elevation: 0.6,
        azimuth: 0.7
      },
      light: {
        ground: "#7A8AA0"
      },
      fog: {
        density: 12e-4
      },
      ground: "#EEF3F8",
      water: null,
      props: [
        // Pine forest, the open snowfield under the peaks, the forest edge.
        {
          kind: "pine",
          side: "both",
          every: 2,
          near: 6,
          far: 30,
          scale: [
            0.6,
            1.1
          ],
          zone: [
            0,
            0.4
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 4,
          near: 4.5,
          far: 60,
          scale: [
            0.7,
            2
          ],
          zone: [
            0,
            0.4
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 1,
          near: 4.5,
          far: 50,
          scale: [
            0.8,
            2.8
          ],
          zone: [
            0.4,
            0.7
          ]
        },
        {
          kind: "pine",
          side: "both",
          every: 5,
          near: 10,
          far: 40,
          scale: [
            0.6,
            1
          ],
          zone: [
            0.4,
            0.7
          ]
        },
        {
          kind: "pine",
          side: "both",
          every: 3,
          near: 6,
          far: 24,
          scale: [
            0.6,
            1.1
          ],
          zone: [
            0.7,
            1
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 3,
          near: 4.5,
          far: 60,
          scale: [
            0.7,
            2.6
          ],
          zone: [
            0.7,
            1
          ]
        },
        // The hero landmark: the ridge chapel over the snowfield.
        {
          kind: "chapelAlpine",
          side: "right",
          at: 0.55,
          near: 60,
          far: 60,
          scale: [
            1.4,
            1.4
          ],
          landmark: true
        }
      ]
    },
    "wilderness-run": {
      sun: {
        color: "#E8EAD8",
        elevation: 0.4,
        azimuth: -0.2
      },
      light: {
        ground: "#3B4A30"
      },
      fog: {
        density: 32e-4
      },
      ground: "#3F6B35",
      water: null,
      props: [
        // Deep forest, the meadow, the forest again with ferns.
        {
          kind: "broadleaf",
          side: "both",
          every: 1,
          near: 3,
          far: 30,
          scale: [
            0.8,
            1.4
          ],
          zone: [
            0,
            0.35
          ]
        },
        {
          kind: "shrub",
          side: "both",
          every: 1,
          near: 2,
          far: 25,
          scale: [
            0.8,
            1.6
          ],
          zone: [
            0,
            0.35
          ]
        },
        {
          kind: "grassTuft",
          side: "both",
          every: 1,
          near: 1,
          far: 30,
          scale: [
            0.9,
            1.6
          ],
          zone: [
            0.35,
            0.65
          ]
        },
        {
          kind: "broadleaf",
          side: "both",
          every: 7,
          near: 12,
          far: 60,
          scale: [
            1,
            1.6
          ],
          zone: [
            0.35,
            0.65
          ]
        },
        {
          kind: "shrub",
          side: "both",
          every: 4,
          near: 4,
          far: 40,
          scale: [
            0.8,
            1.4
          ],
          zone: [
            0.35,
            0.65
          ]
        },
        {
          kind: "broadleaf",
          side: "both",
          every: 2,
          near: 4,
          far: 25,
          scale: [
            0.7,
            1.3
          ],
          zone: [
            0.65,
            1
          ]
        },
        {
          kind: "shrub",
          side: "both",
          every: 1,
          near: 2,
          far: 20,
          scale: [
            0.8,
            1.6
          ],
          zone: [
            0.65,
            1
          ]
        },
        {
          kind: "grassTuft",
          side: "both",
          every: 2,
          near: 1,
          far: 20,
          scale: [
            0.9,
            1.4
          ],
          zone: [
            0.65,
            1
          ]
        },
        // The hero landmark: the great tree alone in the meadow.
        {
          kind: "greatTree",
          side: "left",
          at: 0.5,
          near: 34,
          far: 34,
          scale: [
            1,
            1
          ],
          landmark: true
        }
      ]
    },
    "tulip-gardens": {
      sun: {
        color: "#FFFBE8",
        elevation: 0.3,
        azimuth: 0.3
      },
      light: {
        ground: "#6A8F4A"
      },
      fog: {
        density: 15e-4
      },
      ground: "#7FAE52",
      water: null,
      props: [
        // Open fields, the windmill row, fields with farm trees.
        {
          kind: "grassTuft",
          side: "both",
          every: 1,
          near: 1,
          far: 12,
          scale: [
            0.8,
            1.3
          ]
        },
        {
          kind: "windmill",
          side: "both",
          every: 18,
          near: 30,
          far: 60,
          scale: [
            1.2,
            1.6
          ],
          zone: [
            0,
            0.35
          ]
        },
        {
          kind: "windmill",
          side: "right",
          every: 4,
          near: 14,
          far: 16,
          scale: [
            1.3,
            1.6
          ],
          zone: [
            0.35,
            0.65
          ]
        },
        {
          kind: "broadleaf",
          side: "both",
          every: 5,
          near: 10,
          far: 40,
          scale: [
            0.9,
            1.4
          ],
          zone: [
            0.65,
            1
          ]
        },
        {
          kind: "windmill",
          side: "left",
          every: 20,
          near: 25,
          far: 50,
          scale: [
            1.2,
            1.5
          ],
          zone: [
            0.65,
            1
          ]
        },
        // The concept's polder: a power line along the road, slim turbines far off.
        {
          kind: "powerPole",
          side: "right",
          every: 5,
          near: 7,
          far: 7,
          scale: [
            1,
            1
          ]
        },
        {
          kind: "turbine",
          side: "both",
          every: 22,
          near: 150,
          far: 320,
          scale: [
            0.9,
            1.2
          ]
        },
        // The hero landmark: the great windmill across the field from the row.
        {
          kind: "greatWindmill",
          side: "left",
          at: 0.5,
          near: 40,
          far: 40,
          scale: [
            1,
            1
          ],
          landmark: true
        }
      ]
    },
    "sunset-highway": {
      sun: {
        color: "#FFD05C",
        elevation: 0.04,
        azimuth: 0
      },
      light: {
        ground: "#2A1030"
      },
      fog: {
        density: 14e-4
      },
      ground: "#3B1A3F",
      water: null,
      props: [
        // Desert scrub, the rock garden, the open plain; the poles run on.
        {
          kind: "powerPole",
          side: "right",
          every: 5,
          near: 6,
          far: 6,
          scale: [
            1,
            1
          ]
        },
        {
          kind: "shrub",
          side: "both",
          every: 2,
          near: 4,
          far: 60,
          scale: [
            0.5,
            1
          ],
          zone: [
            0,
            0.4
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 5,
          near: 3,
          far: 80,
          scale: [
            0.5,
            1.4
          ],
          zone: [
            0,
            0.4
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 1,
          near: 3.8,
          far: 40,
          scale: [
            0.8,
            2.4
          ],
          zone: [
            0.4,
            0.7
          ]
        },
        {
          kind: "shrub",
          side: "both",
          every: 6,
          near: 4,
          far: 60,
          scale: [
            0.5,
            1
          ],
          zone: [
            0.7,
            1
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 6,
          near: 6,
          far: 90,
          scale: [
            0.6,
            1.8
          ],
          zone: [
            0.7,
            1
          ]
        },
        // The hero landmark: a lone butte against the dusk.
        {
          kind: "butte",
          side: "left",
          at: 0.55,
          near: 110,
          far: 110,
          scale: [
            1,
            1
          ],
          landmark: true
        }
      ]
    },
    "ancient-ruins": {
      sun: {
        color: "#FFE0A0",
        elevation: 0.18,
        azimuth: -0.6
      },
      light: {
        ground: "#6B4A2A"
      },
      fog: {
        density: 17e-4
      },
      ground: "#C49A62",
      water: null,
      props: [
        // The colonnade, the field of broken arches, the grass hills.
        {
          kind: "column",
          side: "both",
          every: 1,
          near: 3,
          far: 4,
          scale: [
            0.9,
            1.1
          ],
          zone: [
            0,
            0.3
          ]
        },
        {
          kind: "grassTuft",
          side: "both",
          every: 1,
          near: 1,
          far: 25,
          scale: [
            0.8,
            1.3
          ]
        },
        {
          kind: "brokenArch",
          side: "both",
          every: 5,
          near: 12,
          far: 40,
          scale: [
            0.9,
            1.3
          ],
          zone: [
            0.3,
            0.65
          ]
        },
        {
          kind: "column",
          side: "both",
          every: 3,
          near: 6,
          far: 30,
          scale: [
            0.6,
            1.1
          ],
          zone: [
            0.3,
            0.65
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 2,
          near: 4.1,
          far: 50,
          scale: [
            0.6,
            1.8
          ],
          zone: [
            0.3,
            0.65
          ]
        },
        {
          kind: "column",
          side: "both",
          every: 9,
          near: 6,
          far: 40,
          scale: [
            0.7,
            1.2
          ],
          zone: [
            0.65,
            1
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 4,
          near: 4.5,
          far: 60,
          scale: [
            0.6,
            2
          ],
          zone: [
            0.65,
            1
          ]
        },
        // The hero landmark: the aqueduct striding along the grass hills.
        {
          kind: "aqueduct",
          side: "left",
          at: 0.72,
          near: 40,
          far: 40,
          scale: [
            1,
            1
          ],
          landmark: true
        }
      ]
    },
    "metropolis-night": {
      sun: {
        color: "#DFE6FF",
        elevation: 0.25,
        azimuth: 0.3
      },
      light: {
        ground: "#10121C"
      },
      fog: {
        density: 22e-4
      },
      ground: "#15161C",
      water: null,
      props: [
        // Downtown, the waterfront boulevard, downtown again.
        {
          kind: "streetLamp",
          side: "both",
          every: 4,
          near: 1,
          far: 1,
          scale: [
            1,
            1
          ]
        },
        {
          kind: "tower",
          side: "both",
          every: 2,
          near: 18,
          far: 60,
          scale: [
            0.8,
            1.4
          ],
          zone: [
            0,
            0.35
          ]
        },
        {
          kind: "tower",
          side: "right",
          every: 3,
          near: 40,
          far: 90,
          scale: [
            0.7,
            1.2
          ],
          zone: [
            0.35,
            0.6
          ]
        },
        {
          kind: "tower",
          side: "both",
          every: 2,
          near: 18,
          far: 50,
          scale: [
            0.9,
            1.5
          ],
          zone: [
            0.6,
            1
          ]
        },
        // The hero landmark: the spire over the waterfront, across the boulevard
        // from its towers.
        {
          kind: "spire",
          side: "left",
          at: 0.47,
          near: 70,
          far: 70,
          scale: [
            1,
            1
          ],
          landmark: true
        }
      ]
    },
    "coastal-cliffs": {
      sun: {
        color: "#F0F4F0",
        elevation: 0.35,
        azimuth: 0.5
      },
      light: {
        ground: "#48574F"
      },
      fog: {
        density: 24e-4
      },
      ground: "#5E6B4F",
      water: {
        side: "right",
        color: "#2C6F7A"
      },
      props: [
        // Cliff road, the lighthouse headland, cliffs and boulders.
        {
          kind: "cliff",
          side: "left",
          every: 3,
          near: 34,
          far: 60,
          scale: [
            0.8,
            1.6
          ],
          zone: [
            0,
            0.4
          ]
        },
        {
          kind: "grassTuft",
          side: "both",
          every: 1,
          near: 1,
          far: 20,
          scale: [
            0.9,
            1.5
          ]
        },
        {
          kind: "lighthouse",
          side: "right",
          every: 200,
          near: 24,
          far: 24,
          scale: [
            1,
            1
          ],
          zone: [
            0.45,
            0.6
          ]
        },
        // The hero landmark: the rock arch on the headland, the cliffs' side, as
        // on the sea side the land falls away below the road and hid it.
        {
          kind: "seaArch",
          side: "left",
          at: 0.75,
          near: 24,
          far: 24,
          scale: [
            1.3,
            1.3
          ],
          landmark: true
        },
        {
          kind: "rock",
          side: "both",
          every: 3,
          near: 4.5,
          far: 40,
          scale: [
            0.8,
            2
          ],
          zone: [
            0.4,
            0.6
          ]
        },
        {
          kind: "cliff",
          side: "left",
          every: 2,
          near: 34,
          far: 50,
          scale: [
            1,
            1.8
          ],
          zone: [
            0.6,
            1
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 1,
          near: 4.9,
          far: 40,
          scale: [
            0.8,
            2.6
          ],
          zone: [
            0.6,
            1
          ]
        }
      ]
    },
    "destination-marina": {
      sun: {
        color: "#FFFFFF",
        elevation: 0.9,
        azimuth: 0
      },
      light: {
        ground: "#5A7A8A"
      },
      fog: {
        density: 1e-3
      },
      ground: "#E8DCC0",
      water: {
        side: "left",
        color: "#1E78A8"
      },
      props: [
        {
          kind: "sailboat",
          side: "left",
          every: 3,
          near: 24,
          far: 160,
          scale: [
            0.8,
            1.4
          ]
        },
        {
          kind: "palm",
          side: "right",
          every: 4,
          near: 3,
          far: 10,
          scale: [
            0.9,
            1.2
          ]
        },
        // The hero landmark: the harbour clock tower.
        {
          kind: "clockTower",
          side: "right",
          at: 0.5,
          near: 30,
          far: 30,
          scale: [
            1,
            1
          ],
          landmark: true
        }
      ],
      destination: [
        {
          kind: "clockTower",
          scale: 1.1,
          beyond: 270,
          across: 0
        }
      ]
    },
    "destination-oasis": {
      sun: {
        color: "#FFD08A",
        elevation: 0.04,
        azimuth: -0.3
      },
      light: {
        ground: "#5A3A2A"
      },
      fog: {
        density: 16e-4
      },
      ground: "#D8A060",
      water: null,
      props: [
        {
          kind: "dune",
          side: "both",
          every: 5,
          near: 30,
          far: 160,
          scale: [
            0.8,
            1.8
          ]
        },
        {
          kind: "pool",
          side: "both",
          every: 25,
          near: 18,
          far: 30,
          scale: [
            0.9,
            1.3
          ]
        },
        {
          kind: "palm",
          side: "both",
          every: 5,
          near: 8,
          far: 30,
          scale: [
            0.8,
            1.2
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 4,
          near: 6,
          far: 60,
          scale: [
            0.5,
            1.6
          ]
        },
        // The hero landmark: the kasbah over the pools.
        {
          kind: "kasbah",
          side: "left",
          at: 0.5,
          near: 50,
          far: 50,
          scale: [
            1,
            1
          ],
          landmark: true
        }
      ],
      destination: [
        {
          kind: "kasbah",
          scale: 1.3,
          beyond: 245,
          across: 0
        }
      ]
    },
    "destination-castle": {
      sun: {
        color: "#E8D8FF",
        elevation: 0.03,
        azimuth: 0.4
      },
      light: {
        ground: "#1A1828"
      },
      fog: {
        density: 18e-4
      },
      ground: "#2F3A2F",
      water: null,
      props: [
        {
          kind: "castleTower",
          side: "both",
          every: 7,
          near: 18,
          far: 60,
          scale: [
            0.8,
            1.5
          ]
        },
        // The hero landmark: the keep, twice the towers' height.
        {
          kind: "castleTower",
          side: "left",
          at: 0.5,
          near: 45,
          far: 45,
          scale: [
            2.2,
            2.2
          ],
          landmark: true
        },
        {
          kind: "cypress",
          side: "both",
          every: 3,
          near: 3,
          far: 12,
          scale: [
            0.8,
            1.1
          ]
        },
        {
          kind: "rock",
          side: "both",
          every: 3,
          near: 4.5,
          far: 50,
          scale: [
            0.7,
            2
          ]
        },
        {
          kind: "shrub",
          side: "both",
          every: 2,
          near: 2,
          far: 30,
          scale: [
            0.8,
            1.4
          ]
        },
        {
          kind: "grassTuft",
          side: "both",
          every: 1,
          near: 1,
          far: 20,
          scale: [
            0.9,
            1.4
          ]
        }
      ],
      // The castle: its keep over the road's end between two gate towers.
      destination: [
        {
          kind: "castleTower",
          scale: 1.5,
          beyond: 280,
          across: 0
        },
        {
          kind: "castleTower",
          scale: 0.9,
          beyond: 262,
          across: -26
        },
        {
          kind: "castleTower",
          scale: 0.9,
          beyond: 262,
          across: 26
        }
      ]
    },
    "destination-colosseum": {
      sun: {
        color: "#FFF0C8",
        elevation: 0.25,
        azimuth: -0.3
      },
      light: {
        ground: "#6A5038"
      },
      fog: {
        density: 13e-4
      },
      ground: "#B8A078",
      water: null,
      props: [
        {
          kind: "colosseum",
          side: "right",
          at: 0.35,
          near: 100,
          far: 100,
          scale: [
            1,
            1
          ],
          landmark: true
        },
        {
          kind: "column",
          side: "left",
          every: 4,
          near: 3,
          far: 10,
          scale: [
            0.8,
            1.1
          ]
        },
        {
          kind: "shrub",
          side: "both",
          every: 3,
          near: 3,
          far: 30,
          scale: [
            0.6,
            1.2
          ]
        }
      ],
      destination: [
        {
          kind: "colosseum",
          scale: 1,
          beyond: 300,
          across: 0
        }
      ]
    },
    "destination-aerodrome": {
      sun: {
        color: "#FFD8B0",
        elevation: 0.05,
        azimuth: 0.8
      },
      light: {
        ground: "#2A2A3A"
      },
      fog: {
        density: 15e-4
      },
      ground: "#4A5040",
      water: null,
      props: [
        {
          kind: "hangar",
          side: "both",
          every: 18,
          near: 30,
          far: 60,
          scale: [
            0.9,
            1.3
          ]
        },
        // The hero landmark: the great airship hangar.
        {
          kind: "hangar",
          side: "right",
          at: 0.5,
          near: 70,
          far: 70,
          scale: [
            2.6,
            2.6
          ],
          landmark: true
        },
        {
          kind: "runwayLight",
          side: "both",
          every: 1,
          near: 1.5,
          far: 1.5,
          scale: [
            1,
            1
          ]
        },
        {
          kind: "grassTuft",
          side: "both",
          every: 1,
          near: 2,
          far: 40,
          scale: [
            0.9,
            1.4
          ]
        }
      ],
      destination: [
        {
          kind: "hangar",
          scale: 2.6,
          beyond: 270,
          across: 0
        }
      ]
    }
  };

  // apps/apexrun/shell/engine/simulation.js
  var solidCache = /* @__PURE__ */ new Map();
  function solidProps(stage) {
    let bySegment = solidCache.get(stage.id);
    if (!bySegment) {
      bySegment = /* @__PURE__ */ new Map();
      const fork = stage.fork ? stage.fork.forkSegment : stage.segmentCount;
      for (const p of placeProps(stage.id, stage.segmentCount, fork)) {
        if (!(p.kind in PROP_RADIUS) || p.side === 0) continue;
        if (!bySegment.has(p.i)) bySegment.set(p.i, []);
        bySegment.get(p.i).push(p);
      }
      solidCache.set(stage.id, bySegment);
    }
    return bySegment;
  }
  var CAR_HALF_WIDTH = 0.9;
  var CAR_HALF_LENGTH = 1.9;
  var KMH_TO_UNITS_PER_TICK = 0.08;
  var METRES_PER_UNIT = 0.06;
  var LATERAL_UNITS = 8;
  var STEER_FULL = 0.6;
  var STEER_RAMP = 0.06;
  var STEER_RETURN = 0.1;
  var WHEELBASE = 2.4;
  var WHEEL_REACH = 0.08;
  var WHEEL_SPEED_REF = 20;
  var SELF_ALIGN = 4;
  function maxWheel(kmh) {
    return WHEEL_REACH / (1 + kmh / 3.6 / WHEEL_SPEED_REF);
  }
  var BODY_PITCH = 8e-4;
  var BODY_ROLL = 22e-4;
  var BODY_LEAN_MAX = 0.02;
  var BODY_OMEGA = 9;
  var BODY_DAMPING = 0.7;
  var STRETCH_OMEGA = 14;
  var STRETCH_DAMPING = 0.3;
  var STRETCH_KICK = 1.2;
  function restBody() {
    return {
      pitch: 0,
      pitchV: 0,
      roll: 0,
      rollV: 0,
      stretch: 0,
      stretchV: 0
    };
  }
  function spring(x, v, target, omega, damping) {
    const nv = v + (omega * omega * (target - x) - 2 * damping * omega * v) / 60;
    return [
      x + nv / 60,
      nv
    ];
  }
  function springBody(prev, kart) {
    const clamp2 = (t) => Math.max(-BODY_LEAN_MAX, Math.min(BODY_LEAN_MAX, t));
    const b = {
      ...prev.body
    };
    const accel = (kart.speed - prev.speed) / 3.6 * 60;
    const lateral = kart.speed / 3.6 * ((kart.heading || 0) - (prev.heading || 0)) * 60;
    const rollTarget = kart.drift ? kart.driftDir * 0.25 : clamp2(BODY_ROLL * lateral);
    [b.pitch, b.pitchV] = spring(b.pitch, b.pitchV, clamp2(BODY_PITCH * accel), BODY_OMEGA, BODY_DAMPING);
    [b.roll, b.rollV] = spring(b.roll, b.rollV, rollTarget, BODY_OMEGA, BODY_DAMPING);
    if (kart.isNitro && !prev.isNitro) b.stretchV += STRETCH_KICK;
    [b.stretch, b.stretchV] = spring(b.stretch, b.stretchV, 0, STRETCH_OMEGA, STRETCH_DAMPING);
    return b;
  }
  var CLOCK_START_S = 75;
  var CHECKPOINT_S = 45;
  var INTRO_TICKS = 120;
  var ARCH_LEAD = 1800;
  var CRUISE_KMH = 180;
  var DEPART_TICKS = 120;
  var COUNTDOWN_TICKS = 180;
  var GO_TICKS = 60;
  var END_HOLD_TICKS = 150;
  var END_HOLD_MS = END_HOLD_TICKS * 1e3 / 60;
  var ARRIVAL_METRES = 150;
  var ARRIVAL_KMH = 140;
  var ARRIVAL_BRAKE = 10;
  var LANDMARK_LEAD_METRES = 360;
  var FINAL_STAGE = 5;
  var NITRO_KMH = 40;
  var OVER_CAP_SHED = 0.5;
  var OFF_ROAD_SHED = 4;
  var NITRO_TICKS = 150;
  var WAVE_TICKS = 75;
  var WAVE_EVENTS = /* @__PURE__ */ new Set([
    "race-start",
    "close-pass",
    "rival-beaten",
    "checkpoint-extended",
    "arrived"
  ]);
  var NITRO_SHOT = 100 / 3;
  var TURBO_KMH = 30;
  var TRAFFIC_COUNT = 18;
  var RIVAL_LEAD = 1500;
  var RIVAL_TOP_SPEED = 255;
  var RIVALS = [
    "kart-wilber",
    "kart-gnu",
    "kart-suzanne"
  ];
  function placeRival(state) {
    const player = state.karts.find((k) => k.isPlayer);
    const kartId = RIVALS[(state.stageNum - 1) % RIVALS.length];
    const rival = state.karts.find((k) => k.id === kartId);
    rival.z = player.z + RIVAL_LEAD;
    rival.x = 0.22;
    state.rival = {
      kartId,
      beaten: false,
      escaped: false
    };
    return state;
  }
  var CLOSE_PASS_POINTS = 50;
  var CLOSE_PASS_BANNER_TICKS = 48;
  var RIVAL_POINTS = 1e3;
  var totalScore = (state) => Math.round(state.metresDriven * 10) + state.closePassCount * CLOSE_PASS_POINTS + state.rivalsBeaten * RIVAL_POINTS + state.timeBonus;
  var OUTRUN_STAGES = {
    "coconut-beach": {
      id: "coconut-beach",
      name: "Coconut Beach",
      stageNum: 1,
      segmentCount: 380,
      segmentLength: 200,
      curves: [
        {
          start: 30,
          length: 50,
          curve: 1.5,
          pitch: 0
        },
        {
          start: 100,
          length: 60,
          curve: -2,
          pitch: 12
        },
        {
          start: 180,
          length: 50,
          curve: 2.5,
          pitch: -10
        },
        {
          start: 250,
          length: 60,
          curve: -1.8,
          pitch: 8
        }
      ],
      fork: {
        forkSegment: 320,
        leftBranch: "desert-canyons",
        rightBranch: "gateway-pass",
        leftLabel: "DESERT CANYONS",
        rightLabel: "GATEWAY PASS"
      }
    },
    "desert-canyons": {
      id: "desert-canyons",
      name: "Desert Canyons",
      stageNum: 2,
      segmentCount: 380,
      segmentLength: 200,
      curves: [
        {
          start: 30,
          length: 45,
          curve: -3,
          pitch: 15
        },
        {
          start: 95,
          length: 55,
          curve: 3.5,
          pitch: -15
        },
        {
          start: 170,
          length: 60,
          curve: -2.8,
          pitch: 10
        },
        {
          start: 250,
          length: 50,
          curve: 3,
          pitch: -5
        }
      ],
      fork: {
        forkSegment: 320,
        leftBranch: "alpine-peaks",
        rightBranch: "wilderness-run",
        leftLabel: "ALPINE PEAKS",
        rightLabel: "WILDERNESS RUN"
      }
    },
    "gateway-pass": {
      id: "gateway-pass",
      name: "Gateway Pass",
      stageNum: 2,
      segmentCount: 380,
      segmentLength: 200,
      curves: [
        {
          start: 40,
          length: 50,
          curve: 2.2,
          pitch: 20
        },
        {
          start: 110,
          length: 60,
          curve: -3.2,
          pitch: -18
        },
        {
          start: 190,
          length: 50,
          curve: 2.8,
          pitch: 12
        }
      ],
      fork: {
        forkSegment: 320,
        leftBranch: "wilderness-run",
        rightBranch: "tulip-gardens",
        leftLabel: "WILDERNESS RUN",
        rightLabel: "TULIP GARDENS"
      }
    },
    "alpine-peaks": {
      id: "alpine-peaks",
      name: "Alpine Peaks",
      stageNum: 3,
      segmentCount: 380,
      segmentLength: 200,
      curves: [
        {
          start: 30,
          length: 60,
          curve: -3.5,
          pitch: 25
        },
        {
          start: 110,
          length: 60,
          curve: 4,
          pitch: -22
        },
        {
          start: 190,
          length: 65,
          curve: -3,
          pitch: 15
        }
      ],
      fork: {
        forkSegment: 320,
        leftBranch: "sunset-highway",
        rightBranch: "ancient-ruins",
        leftLabel: "SUNSET HIGHWAY",
        rightLabel: "ANCIENT RUINS"
      }
    },
    "wilderness-run": {
      id: "wilderness-run",
      name: "Wilderness Run",
      stageNum: 3,
      segmentCount: 380,
      segmentLength: 200,
      curves: [
        {
          start: 35,
          length: 55,
          curve: 2.6,
          pitch: 10
        },
        {
          start: 105,
          length: 55,
          curve: -3,
          pitch: -10
        },
        {
          start: 185,
          length: 60,
          curve: 3.2,
          pitch: 14
        }
      ],
      fork: {
        forkSegment: 320,
        leftBranch: "ancient-ruins",
        rightBranch: "metropolis-night",
        leftLabel: "ANCIENT RUINS",
        rightLabel: "METROPOLIS NIGHT"
      }
    },
    "tulip-gardens": {
      id: "tulip-gardens",
      name: "Tulip Gardens",
      stageNum: 3,
      segmentCount: 380,
      segmentLength: 200,
      curves: [
        {
          start: 40,
          length: 50,
          curve: -2.4,
          pitch: 0
        },
        {
          start: 110,
          length: 60,
          curve: 2.8,
          pitch: 10
        },
        {
          start: 190,
          length: 55,
          curve: -2.5,
          pitch: -8
        }
      ],
      fork: {
        forkSegment: 320,
        leftBranch: "metropolis-night",
        rightBranch: "coastal-cliffs",
        leftLabel: "METROPOLIS NIGHT",
        rightLabel: "COASTAL CLIFFS"
      }
    },
    "sunset-highway": {
      id: "sunset-highway",
      name: "Sunset Highway",
      stageNum: 4,
      segmentCount: 380,
      segmentLength: 200,
      curves: [
        {
          start: 40,
          length: 60,
          curve: 3,
          pitch: 0
        },
        {
          start: 120,
          length: 60,
          curve: -3,
          pitch: 10
        },
        {
          start: 200,
          length: 60,
          curve: 2.5,
          pitch: -10
        }
      ],
      fork: {
        forkSegment: 320,
        leftBranch: "destination-marina",
        rightBranch: "destination-oasis",
        leftLabel: "MARINA BAY [A]",
        rightLabel: "DESERT OASIS [B]"
      }
    },
    "ancient-ruins": {
      id: "ancient-ruins",
      name: "Ancient Ruins",
      stageNum: 4,
      segmentCount: 380,
      segmentLength: 200,
      curves: [
        {
          start: 30,
          length: 50,
          curve: -2.8,
          pitch: 12
        },
        {
          start: 100,
          length: 65,
          curve: 3.2,
          pitch: -14
        },
        {
          start: 180,
          length: 60,
          curve: -3,
          pitch: 10
        }
      ],
      fork: {
        forkSegment: 320,
        leftBranch: "destination-oasis",
        rightBranch: "destination-castle",
        leftLabel: "DESERT OASIS [B]",
        rightLabel: "GRAND CASTLE [C]"
      }
    },
    "metropolis-night": {
      id: "metropolis-night",
      name: "Metropolis Night",
      stageNum: 4,
      segmentCount: 380,
      segmentLength: 200,
      curves: [
        {
          start: 40,
          length: 60,
          curve: 3.5,
          pitch: 18
        },
        {
          start: 120,
          length: 60,
          curve: -3.8,
          pitch: -16
        },
        {
          start: 200,
          length: 60,
          curve: 3,
          pitch: 8
        }
      ],
      fork: {
        forkSegment: 320,
        leftBranch: "destination-castle",
        rightBranch: "destination-colosseum",
        leftLabel: "GRAND CASTLE [C]",
        rightLabel: "COLOSSEUM [D]"
      }
    },
    "coastal-cliffs": {
      id: "coastal-cliffs",
      name: "Coastal Cliffs",
      stageNum: 4,
      segmentCount: 380,
      segmentLength: 200,
      curves: [
        {
          start: 30,
          length: 55,
          curve: -3.2,
          pitch: 15
        },
        {
          start: 105,
          length: 60,
          curve: 3.6,
          pitch: -15
        },
        {
          start: 185,
          length: 60,
          curve: -3,
          pitch: 10
        }
      ],
      fork: {
        forkSegment: 320,
        leftBranch: "destination-colosseum",
        rightBranch: "destination-aerodrome",
        leftLabel: "COLOSSEUM [D]",
        rightLabel: "AERODROME [E]"
      }
    },
    "destination-marina": {
      id: "destination-marina",
      name: "Marina Bay [Ending A]",
      stageNum: 5,
      segmentCount: 300,
      segmentLength: 200,
      curves: [
        {
          start: 40,
          length: 60,
          curve: 2,
          pitch: 0
        },
        {
          start: 140,
          length: 60,
          curve: -2,
          pitch: 0
        }
      ],
      fork: null
    },
    "destination-oasis": {
      id: "destination-oasis",
      name: "Desert Oasis [Ending B]",
      stageNum: 5,
      segmentCount: 300,
      segmentLength: 200,
      curves: [
        {
          start: 50,
          length: 60,
          curve: -2.2,
          pitch: 5
        },
        {
          start: 150,
          length: 50,
          curve: 2.5,
          pitch: -5
        }
      ],
      fork: null
    },
    "destination-castle": {
      id: "destination-castle",
      name: "Grand Castle [Ending C]",
      stageNum: 5,
      segmentCount: 300,
      segmentLength: 200,
      curves: [
        {
          start: 40,
          length: 50,
          curve: 2.5,
          pitch: 8
        },
        {
          start: 130,
          length: 60,
          curve: -2.5,
          pitch: -8
        }
      ],
      fork: null
    },
    "destination-colosseum": {
      id: "destination-colosseum",
      name: "Colosseum Plaza [Ending D]",
      stageNum: 5,
      segmentCount: 300,
      segmentLength: 200,
      curves: [
        {
          start: 45,
          length: 55,
          curve: -2,
          pitch: 0
        },
        {
          start: 140,
          length: 55,
          curve: 2,
          pitch: 0
        }
      ],
      fork: null
    },
    "destination-aerodrome": {
      id: "destination-aerodrome",
      name: "Aerodrome Runway [Ending E]",
      stageNum: 5,
      segmentCount: 300,
      segmentLength: 200,
      curves: [
        {
          start: 50,
          length: 40,
          curve: 1.2,
          pitch: 0
        },
        {
          start: 140,
          length: 40,
          curve: -1.2,
          pitch: 0
        }
      ],
      fork: null
    }
  };
  var CHARACTERS = {
    tux: {
      name: "Apex GT Spyder",
      topSpeed: 295,
      accel: 1.45,
      handling: 1.2,
      color: "#D32F2F"
    },
    wilber: {
      name: "Wilber GT",
      topSpeed: 285,
      accel: 1.5,
      handling: 1.3,
      color: "#FF9800"
    },
    gnu: {
      name: "Gnu Turbo",
      topSpeed: 300,
      accel: 1.35,
      handling: 1.1,
      color: "#9C27B0"
    },
    suzanne: {
      name: "Suzanne GT",
      topSpeed: 288,
      accel: 1.42,
      handling: 1.22,
      color: "#4CAF50"
    }
  };
  var segmentCache = /* @__PURE__ */ new Map();
  function stageSegments(stageConfig) {
    if (!segmentCache.has(stageConfig.id)) segmentCache.set(stageConfig.id, Object.freeze(createSegments(stageConfig).map(Object.freeze)));
    return segmentCache.get(stageConfig.id);
  }
  function createSegments(stageConfig) {
    const segments = [];
    const count = stageConfig.segmentCount;
    for (let i = 0; i < count; i++) {
      segments.push({
        index: i,
        curve: 0,
        pitch: 0
      });
    }
    for (const c of stageConfig.curves || []) {
      for (let i = 0; i < c.length; i++) {
        const idx = (c.start + i) % count;
        segments[idx].curve = c.curve;
        segments[idx].pitch = c.pitch;
      }
    }
    return segments;
  }
  var LANES = [
    -0.65,
    -0.22,
    0.22,
    0.65
  ];
  var LANE_CLEAR = 12 / METRES_PER_UNIT;
  var FOLLOW_CLOSE = 12 / METRES_PER_UNIT;
  var CAR_GAP = 7 / METRES_PER_UNIT;
  function sideBySide(xa, wa, xb, wb) {
    return Math.abs(xa - xb) < (wa + wb) / 2 + 0.04;
  }
  function wrapDz(dz, trackLength) {
    const w = (dz % trackLength + trackLength) % trackLength;
    return w > trackLength / 2 ? w - trackLength : w;
  }
  var TRAFFIC_TYPES = {
    convertible: {
      speed: 150,
      spread: 25,
      width: 0.25,
      length: 0.42
    },
    pickup: {
      speed: 135,
      spread: 20,
      width: 0.28,
      length: 0.5
    },
    truck: {
      speed: 105,
      spread: 15,
      width: 0.35,
      length: 0.9
    },
    sedan: {
      speed: 125,
      spread: 20,
      width: 0.25,
      length: 0.45
    }
  };
  var HANDOVER_CLEAR = 6e3;
  function spawnTraffic(stageConfig, seed, start = 450) {
    const traffic = [];
    const types = Object.keys(TRAFFIC_TYPES);
    const rand = createPrng(seed);
    const count = TRAFFIC_COUNT;
    const spacing = Math.floor(stageConfig.segmentCount * stageConfig.segmentLength * 0.8 / count);
    for (let i = 0; i < count; i++) {
      const laneIdx = Math.floor(rand() * LANES.length);
      const typeIdx = Math.floor(rand() * types.length);
      const type = types[typeIdx];
      const spec = TRAFFIC_TYPES[type];
      const baseSpeed = spec.speed + Math.floor(rand() * spec.spread);
      const { width, length } = spec;
      traffic.push({
        id: `traffic-${i}`,
        type,
        x: LANES[laneIdx],
        targetX: LANES[laneIdx],
        z: start + i * spacing,
        speed: baseSpeed,
        baseSpeed,
        width,
        length,
        laneTimer: 180 + Math.floor(rand() * 300),
        blinker: 0,
        brake: 0,
        passed: false
      });
    }
    return traffic;
  }
  function arrive(next, kart) {
    const stop = next.trackLength + ARRIVAL_METRES / METRES_PER_UNIT;
    const left = (stop - kart.z) * METRES_PER_UNIT;
    const braking = Math.sqrt(2 * ARRIVAL_BRAKE * left) * 3.6;
    kart.speed = Math.min(kart.speed + (ARRIVAL_KMH - kart.speed) * 0.06, braking);
    kart.x += (Math.max(-LANES[LANES.length - 1], Math.min(LANES[LANES.length - 1], kart.x)) - kart.x) * 0.05;
    kart.steerAngle *= 0.85;
    kart.heading = (kart.heading || 0) * 0.9;
    kart.drift = false;
    kart.isNitro = false;
    kart.nitroTimer = 0;
    kart.turboTimer = 0;
    if (kart.spinTimer > 0) kart.spinTimer--;
    kart.gear = kart.speed > 165 ? "high" : "low";
    kart.rpm = Math.round(1200 + kart.speed / (kart.gear === "low" ? 180 : 295) * 7600);
    kart.z = Math.min(stop, kart.z + kart.speed * KMH_TO_UNITS_PER_TICK);
    if (kart.z === stop && next.parkedAt === null) {
      kart.speed = 0;
      kart.rpm = 1e3;
      next.parkedAt = next.endTicks;
      next.events.push({
        type: "arrived"
      });
    }
  }
  var DUEL_CARS = [
    "tux",
    "suzanne"
  ];
  function duelState(seed, stage) {
    const karts = DUEL_CARS.map((character, seat) => ({
      id: `kart-seat-${seat}`,
      character,
      car: "tux",
      name: `Seat ${seat + 1}`,
      isPlayer: true,
      seat,
      x: seat === 0 ? -0.3 : 0.3,
      z: 0,
      speed: 0,
      steerAngle: 0,
      gear: "low",
      drift: false,
      driftDir: 0,
      driftCharge: 0,
      turboTimer: 0,
      nitroFuel: 100,
      nitroTimer: 0,
      nitroHeld: false,
      isNitro: false,
      body: restBody(),
      waveTimer: 0,
      spinTimer: 0,
      crashed: false,
      currentLap: stage.stageNum || 1,
      rpm: 1e3
    }));
    return {
      tick: 0,
      seed,
      stageState: "warmup",
      countdown: INTRO_TICKS + COUNTDOWN_TICKS,
      goTimer: 0,
      departTimer: 0,
      timeRemaining: CLOCK_START_S,
      timeElapsed: 0,
      score: 0,
      closePassCount: 0,
      stageId: stage.id,
      stageNum: stage.stageNum || 1,
      routeHistory: [
        stage.id
      ],
      forkActive: false,
      forkPassed: false,
      nextStageId: null,
      endTicks: 0,
      stageClear: null,
      closePassBannerTimer: 0,
      rivalBannerTimer: 0,
      closePassBonus: 0,
      enterHeld: false,
      trackName: stage.name,
      trackLength: stage.segmentCount * stage.segmentLength,
      segmentCount: stage.segmentCount,
      segmentLength: stage.segmentLength,
      winnerId: null,
      karts,
      traffic: spawnTraffic(stage, seed),
      events: [],
      metresDriven: 0,
      rival: {
        kartId: "",
        beaten: false,
        escaped: false
      },
      rivalsBeaten: 0,
      timeBonus: 0,
      // The tick each seat reached the goal, and the seat that won.
      duel: {
        goal: DUEL_CARS.map(() => null),
        winner: null
      }
    };
  }
  function endDuel(next) {
    if (next.duel.winner !== null || next.stageState === "finished") return next;
    const reached = next.duel.goal.map((tick, seat) => ({
      tick,
      seat
    })).filter((g) => g.tick !== null);
    const timedOut = next.stageState === "game_over";
    if (reached.length === 0 && !timedOut) return next;
    const [a, b] = next.karts;
    const winner = reached.length === 1 ? reached[0].seat : reached.length > 1 ? null : a.z === b.z ? null : a.z > b.z ? a.seat : b.seat;
    next.duel.winner = winner;
    next.winnerId = winner === null ? null : next.karts[winner].id;
    next.stageState = "finished";
    next.events.push({
      type: "duel-end",
      winner,
      goal: next.duel.goal.slice(),
      ticks: next.tick
    });
    return next;
  }
  var INPUT_BITS = [
    "up",
    "down",
    "left",
    "right",
    "drift",
    "nitro"
  ];
  var COMMAND_BITS = [
    ...INPUT_BITS,
    "enter"
  ];
  var decodeCommand = (bytes) => ({
    ...Object.fromEntries(COMMAND_BITS.map((key, bit) => [
      key,
      (bytes[0] & 1 << bit) !== 0
    ])),
    gear: [
      void 0,
      "high",
      "low"
    ][bytes[1]]
  });
  var decodeInputs = (bytes, gone) => [
    ...bytes
  ].map((byte, seat) => Object.fromEntries(INPUT_BITS.map((key, bit) => [
    key,
    !gone[seat] && (byte & 1 << bit) !== 0
  ])));
  function viewForSeat(state, seat) {
    if (!state.duel) return state;
    return {
      ...state,
      karts: state.karts.map((kart) => ({
        ...kart,
        isPlayer: kart.seat === seat,
        character: kart.seat === seat ? "tux" : "suzanne"
      }))
    };
  }
  var apexrunEngine = {
    rateHz: 60,
    OUTRUN_STAGES,
    initState(seed = 4919, options = {}) {
      const stageId = options.stageId ?? "coconut-beach";
      const stage = OUTRUN_STAGES[stageId];
      if (!stage) throw new Error(`simulation: unknown stage ${stageId}`);
      if (options.duel) return duelState(seed, stage);
      const karts = [
        {
          id: "kart-player",
          character: "tux",
          name: CHARACTERS.tux.name,
          isPlayer: true,
          x: options.playerX ?? 0,
          // A pit-lane scenario can start the player anywhere along the stage.
          z: options.playerZ ?? 0,
          speed: options.playerSpeed ?? 0,
          steerAngle: 0,
          gear: "low",
          drift: false,
          driftDir: 0,
          driftCharge: 0,
          turboTimer: 0,
          nitroFuel: 100,
          nitroTimer: 0,
          nitroHeld: false,
          isNitro: false,
          body: restBody(),
          waveTimer: 0,
          spinTimer: 0,
          crashed: false,
          currentLap: stage.stageNum || 1,
          rpm: 1e3
        },
        {
          id: "kart-wilber",
          character: "wilber",
          name: "Wilber GT",
          isPlayer: false,
          x: 0.45,
          z: 400,
          speed: 0,
          steerAngle: 0,
          gear: "low",
          drift: false,
          driftDir: 0,
          driftCharge: 0,
          turboTimer: 0,
          nitroFuel: 50,
          nitroTimer: 0,
          nitroHeld: false,
          isNitro: false,
          body: restBody(),
          waveTimer: 0,
          spinTimer: 0,
          crashed: false,
          currentLap: stage.stageNum || 1,
          rpm: 1e3
        },
        {
          id: "kart-gnu",
          character: "gnu",
          name: "Gnu Turbo",
          isPlayer: false,
          x: -0.45,
          z: 800,
          speed: 0,
          steerAngle: 0,
          gear: "low",
          drift: false,
          driftDir: 0,
          driftCharge: 0,
          turboTimer: 0,
          nitroFuel: 50,
          nitroTimer: 0,
          nitroHeld: false,
          isNitro: false,
          body: restBody(),
          waveTimer: 0,
          spinTimer: 0,
          crashed: false,
          currentLap: stage.stageNum || 1,
          rpm: 1e3
        },
        {
          id: "kart-suzanne",
          character: "suzanne",
          name: "Suzanne GT",
          isPlayer: false,
          x: 0.22,
          z: 1200,
          speed: 0,
          steerAngle: 0,
          gear: "low",
          drift: false,
          driftDir: 0,
          driftCharge: 0,
          turboTimer: 0,
          nitroFuel: 50,
          nitroTimer: 0,
          nitroHeld: false,
          isNitro: false,
          body: restBody(),
          waveTimer: 0,
          spinTimer: 0,
          crashed: false,
          currentLap: stage.stageNum || 1,
          rpm: 1e3
        }
      ];
      const traffic = spawnTraffic(stage, seed);
      return placeRival({
        tick: 0,
        seed,
        stageState: options.stageState || "warmup",
        countdown: (options.stageState || "warmup") === "warmup" ? INTRO_TICKS + COUNTDOWN_TICKS : 0,
        goTimer: 0,
        departTimer: 0,
        timeRemaining: CLOCK_START_S,
        timeElapsed: 0,
        score: 0,
        closePassCount: 0,
        stageId: stage.id,
        stageNum: stage.stageNum || 1,
        routeHistory: [
          stage.id
        ],
        forkActive: false,
        forkPassed: false,
        // The stage the arch leads to, and the one just cleared, for the
        // hand-over's card.
        nextStageId: null,
        // Ticks since the run ended.
        endTicks: 0,
        stageClear: null,
        closePassBannerTimer: 0,
        rivalBannerTimer: 0,
        closePassBonus: 0,
        enterHeld: false,
        trackName: stage.name,
        trackLength: stage.segmentCount * stage.segmentLength,
        segmentCount: stage.segmentCount,
        segmentLength: stage.segmentLength,
        winnerId: null,
        karts,
        traffic,
        events: [],
        metresDriven: 0,
        rival: {
          kartId: "",
          beaten: false,
          escaped: false
        },
        rivalsBeaten: 0,
        timeBonus: 0
      });
    },
    advanceFrame(state, inputs = {}) {
      const next = JSON.parse(JSON.stringify(state));
      next.tick++;
      next.events = [];
      if (next.stageState === "finished" || next.stageState === "game_over") next.endTicks++;
      const enterPressed = !!inputs.enter && !state.enterHeld;
      next.enterHeld = !!inputs.enter;
      if (state.tick === 0) next.events.push({
        type: "race-grid"
      });
      if (next.stageState === "title") {
        if (enterPressed) {
          next.stageState = "warmup";
          next.countdown = INTRO_TICKS + COUNTDOWN_TICKS;
        }
        return next;
      }
      if (next.goTimer > 0) next.goTimer--;
      if (next.stageState === "checkpoint" && next.departTimer > 0) {
        next.departTimer--;
        if (next.departTimer === 0 || enterPressed) {
          next.departTimer = 0;
          next.stageState = "racing";
          next.goTimer = GO_TICKS;
        }
      }
      if (next.closePassBannerTimer > 0) {
        next.closePassBannerTimer--;
      }
      if (next.rivalBannerTimer > 0) {
        next.rivalBannerTimer--;
      }
      if (next.stageState === "warmup" && enterPressed && next.countdown > COUNTDOWN_TICKS) next.countdown = COUNTDOWN_TICKS;
      if (next.countdown > 0) {
        next.countdown--;
        if (next.countdown === 0 && next.stageState === "warmup") {
          next.stageState = "racing";
          next.goTimer = GO_TICKS;
          next.events.push({
            type: "race-start"
          });
        }
      }
      const currentStage = OUTRUN_STAGES[next.stageId] || OUTRUN_STAGES["coconut-beach"];
      const segments = stageSegments(currentStage);
      const trackLength = next.trackLength;
      const pastFork = (z) => !!currentStage.fork && Math.floor(z / currentStage.segmentLength) >= currentStage.fork.forkSegment;
      if (next.stageState === "racing") {
        next.timeElapsed += 1 / 60;
        next.timeRemaining = Math.max(0, next.timeRemaining - 1 / 60);
        if (next.timeRemaining <= 0) {
          next.stageState = "game_over";
          next.events.push({
            type: "time-out"
          });
        }
      }
      const canDrive = next.stageState === "racing" || next.stageState === "checkpoint";
      const autopilot = next.stageState === "checkpoint";
      const arriving = next.stageState === "finished" && !next.duel;
      if (canDrive && next.traffic) {
        for (let i = 0; i < next.traffic.length; i++) {
          const t = next.traffic[i];
          t.z = (t.z + t.speed * KMH_TO_UNITS_PER_TICK) % trackLength;
          t.laneTimer--;
          if (t.laneTimer <= 0) {
            let currentLaneIdx = 0;
            let bestDist = 999;
            for (let l = 0; l < LANES.length; l++) {
              const d = Math.abs(LANES[l] - t.targetX);
              if (d < bestDist) {
                bestDist = d;
                currentLaneIdx = l;
              }
            }
            const [prngVal] = prngStep((next.seed ^ next.tick * 1009 + i * 37) >>> 0);
            let dir = 0;
            if (currentLaneIdx === 0) dir = 1;
            else if (currentLaneIdx === LANES.length - 1) dir = -1;
            else dir = prngVal > 0.5 ? 1 : -1;
            let nextLaneIdx = Math.max(0, Math.min(LANES.length - 1, currentLaneIdx + dir));
            if (pastFork(t.z) && LANES[nextLaneIdx] < 0 !== LANES[currentLaneIdx] < 0) {
              nextLaneIdx = currentLaneIdx - dir;
            }
            const into = LANES[nextLaneIdx];
            const taken = next.traffic.some((o, j) => j !== i && (sideBySide(o.x, o.width, into, t.width) || sideBySide(o.targetX, o.width, into, t.width)) && Math.abs(wrapDz(o.z - t.z, trackLength)) < LANE_CLEAR);
            if (taken) {
              t.laneTimer = 60;
            } else {
              t.targetX = into;
              t.blinker = t.targetX > t.x ? 1 : t.targetX < t.x ? -1 : 0;
              t.laneTimer = 240 + Math.floor(prngVal * 360);
            }
          }
          const ldx = t.targetX - t.x;
          if (Math.abs(ldx) > 6e-3) {
            t.x += Math.sign(ldx) * 6e-3;
          } else {
            t.x = t.targetX;
            t.blinker = 0;
          }
          let lead = null;
          let leadCarDist = 99999;
          for (let j = 0; j < next.traffic.length; j++) {
            if (i === j) continue;
            const other = next.traffic[j];
            if (sideBySide(other.x, other.width, t.x, t.width)) {
              const dz = (other.z - t.z + trackLength) % trackLength;
              if (dz > 0 && dz < 350 && dz < leadCarDist) {
                leadCarDist = dz;
                lead = other;
              }
            }
          }
          if (lead && leadCarDist < 250) {
            t.brake = 1;
            t.speed = leadCarDist < FOLLOW_CLOSE ? Math.min(t.speed, lead.speed) : Math.max(80, Math.min(t.speed - 0.5, lead.speed));
            if (leadCarDist < CAR_GAP) t.z = (lead.z - CAR_GAP + trackLength) % trackLength;
          } else {
            t.brake = 0;
            if (t.speed < t.baseSpeed) {
              t.speed = Math.min(t.baseSpeed, t.speed + 0.2);
            }
          }
        }
      }
      for (let k = 0; k < next.karts.length; k++) {
        const kart = next.karts[k];
        const stats = CHARACTERS[kart.car ?? kart.character];
        const own = next.duel ? inputs[kart.seat] ?? {} : inputs;
        const nitroDown = kart.isPlayer && !!own.nitro;
        const nitroPress = nitroDown && !kart.nitroHeld && !autopilot;
        kart.nitroHeld = nitroDown;
        if (autopilot) kart.nitroTimer = 0;
        if (arriving && kart.isPlayer) {
          arrive(next, kart);
          continue;
        }
        if (!canDrive) {
          kart.speed = 0;
          kart.rpm = 1e3;
          kart.isNitro = false;
          kart.nitroTimer = 0;
          continue;
        }
        if (kart.spinTimer > 0) {
          kart.isNitro = false;
          kart.nitroTimer = 0;
          kart.heading = 0;
          kart.steerAngle = 0;
          kart.spinTimer--;
          kart.speed *= 0.94;
          if (kart.crashed) kart.x += (Math.sign(kart.x) * 0.85 - kart.x) * 0.12;
          if (kart.spinTimer === 0) kart.crashed = false;
          kart.z += kart.speed * KMH_TO_UNITS_PER_TICK;
          continue;
        }
        const isPlayer = kart.isPlayer;
        const cmd = isPlayer && !autopilot ? own : {};
        const accelInput = isPlayer ? !!(cmd.up || cmd.forward || cmd.jump) : true;
        const brakeInput = isPlayer ? !!(cmd.down || cmd.backward) : false;
        const steerLeft = isPlayer ? !!(cmd.left || cmd.strafeLeft) : false;
        const steerRight = isPlayer ? !!(cmd.right || cmd.strafeRight) : false;
        const driftInput = isPlayer ? !!(cmd.run || cmd.drift) : false;
        if (cmd.gear === "low" || cmd.gear === "high") {
          kart.gear = cmd.gear;
        } else {
          kart.gear = kart.speed > 165 ? "high" : "low";
        }
        let maxSpeed = kart.id === next.rival.kartId ? Math.min(stats.topSpeed, RIVAL_TOP_SPEED) : stats.topSpeed;
        if (kart.gear === "low") {
          maxSpeed = Math.min(maxSpeed, 185);
        }
        if (nitroPress && kart.nitroTimer === 0 && nitroStatus(kart).charges > 0) {
          kart.nitroTimer = NITRO_TICKS;
          kart.nitroFuel = Math.max(0, kart.nitroFuel - NITRO_SHOT);
        }
        if (kart.nitroTimer > 0) {
          kart.nitroTimer--;
          kart.isNitro = true;
          maxSpeed += NITRO_KMH;
        } else {
          kart.isNitro = false;
          kart.nitroFuel = Math.min(100, kart.nitroFuel + 0.04);
        }
        if (kart.turboTimer > 0) {
          kart.turboTimer--;
          maxSpeed += TURBO_KMH;
        }
        const offRoad = Math.abs(kart.x) > 1;
        if (offRoad) {
          maxSpeed = Math.min(maxSpeed, 45);
          if (kart.speed > maxSpeed) kart.speed = Math.max(maxSpeed, kart.speed - OFF_ROAD_SHED);
        }
        if (accelInput) {
          const gearAccelMultiplier = kart.gear === "low" ? 1.3 : kart.speed > 140 ? 0.9 : 0.4;
          const before = kart.speed;
          kart.speed += stats.accel * gearAccelMultiplier;
          if (kart.speed > maxSpeed) kart.speed = Math.max(maxSpeed, Math.min(kart.speed, before - OVER_CAP_SHED));
        } else if (brakeInput) {
          kart.speed -= 2.2;
          if (kart.speed < 0) kart.speed = 0;
        } else {
          kart.speed -= 0.35;
          if (kart.speed < 0) kart.speed = 0;
        }
        const currentSegIdx = Math.floor(kart.z / currentStage.segmentLength) % segments.length;
        const currentSeg = segments[currentSegIdx] || segments[0];
        if (driftInput && (steerLeft || steerRight) && kart.speed > 50) {
          if (!kart.drift) {
            kart.drift = true;
            kart.driftDir = steerLeft ? -1 : 1;
            kart.driftCharge = 0;
            next.events.push({
              type: "drift-start",
              kartId: kart.id
            });
          }
        }
        const stick = kart.drift ? kart.driftDir : (steerRight ? 1 : 0) - (steerLeft ? 1 : 0);
        const wheelTarget = stick * STEER_FULL;
        const wheelStep = stick === 0 ? STEER_RETURN : STEER_RAMP;
        kart.steerAngle = (kart.steerAngle || 0) + Math.max(-wheelStep, Math.min(wheelStep, wheelTarget - (kart.steerAngle || 0)));
        const v = kart.speed / 3.6;
        const wheel = kart.steerAngle / STEER_FULL * maxWheel(kart.speed) * stats.handling * (kart.drift ? 1.35 : 1);
        kart.heading = (kart.heading || 0) + (v * Math.tan(wheel) / WHEELBASE - SELF_ALIGN * (kart.heading || 0)) / 60;
        kart.x += v * Math.sin(kart.heading) / 60 / LATERAL_UNITS;
        if (kart.drift) {
          kart.driftCharge = Math.min(100, (kart.driftCharge || 0) + 1.2);
          if (!driftInput) {
            if (kart.driftCharge > 40) {
              kart.turboTimer = 45;
              next.events.push({
                type: "mini-turbo",
                kartId: kart.id
              });
            }
            kart.drift = false;
            kart.driftCharge = 0;
          }
        }
        if (currentSeg.curve !== 0 && kart.speed > 30) {
          const centrifugal = currentSeg.curve * 22e-4 * (kart.speed / 200);
          kart.x -= centrifugal;
        }
        kart.x = Math.max(-2, Math.min(2, kart.x));
        if (isPlayer && autopilot) {
          kart.speed += (CRUISE_KMH - kart.speed) * 0.08;
          kart.x += ((kart.x < 0 ? -1 : 1) * 0.45 - kart.x) * 0.08;
        }
        const gearRatio = kart.gear === "low" ? 180 : 295;
        kart.rpm = Math.round(1200 + kart.speed / gearRatio * 7600);
        const fromZ = kart.z;
        kart.z += kart.speed * KMH_TO_UNITS_PER_TICK;
        if (isPlayer && !next.duel && next.stageState === "racing") {
          const opens = heroSegment(currentStage.id, currentStage.segmentCount) * currentStage.segmentLength - LANDMARK_LEAD_METRES / METRES_PER_UNIT;
          if (fromZ < opens && kart.z >= opens) next.events.push({
            type: "landmark-ahead"
          });
        }
        if (isPlayer && !autopilot && kart.spinTimer === 0 && Math.abs(kart.x) > 1) {
          const seg = Math.floor(kart.z / currentStage.segmentLength);
          const lateral = Math.abs(kart.x) * LATERAL_UNITS;
          for (let i = seg - 1; i <= seg + 1 && kart.spinTimer === 0; i++) {
            for (const p of solidProps(currentStage).get(i) ?? []) {
              if (Math.sign(kart.x) !== p.side) continue;
              const r = PROP_RADIUS[p.kind] * p.scale;
              const dz = Math.abs(kart.z - i * currentStage.segmentLength) * METRES_PER_UNIT;
              const dx = Math.abs(lateral - (LATERAL_UNITS + p.offset));
              if (dz < r + CAR_HALF_LENGTH && dx < r + CAR_HALF_WIDTH) {
                kart.spinTimer = 45;
                kart.crashed = true;
                kart.speed = Math.min(kart.speed * 0.3, 30);
                next.events.push({
                  type: "prop-crash",
                  kind: p.kind
                });
                break;
              }
            }
          }
        }
        if (isPlayer && !autopilot && next.traffic) {
          for (const t of next.traffic) {
            if (pastFork(kart.z) && kart.x < 0 !== t.x < 0) continue;
            const dz = Math.abs(kart.z - t.z);
            const dx = Math.abs(kart.x - t.x);
            const prevZ = kart.z - kart.speed * KMH_TO_UNITS_PER_TICK;
            const sweptZ = prevZ <= t.z && kart.z >= t.z;
            if ((dz < 100 || sweptZ) && dx < t.width && kart.spinTimer === 0) {
              kart.spinTimer = 35;
              kart.speed = Math.min(kart.speed * 0.45, 65);
              next.events.push({
                type: "traffic-collision",
                trafficId: t.id,
                trafficType: t.type
              });
            } else if ((dz < 160 || sweptZ) && dx >= t.width && dx <= 0.6 && kart.speed > 160) {
              if (!t.passed) {
                t.passed = true;
                next.closePassCount++;
                next.closePassBannerTimer = CLOSE_PASS_BANNER_TICKS;
                next.closePassBonus = 50;
                next.events.push({
                  type: "close-pass",
                  trafficId: t.id,
                  trafficType: t.type,
                  speed: Math.round(kart.speed),
                  scoreBonus: 50
                });
              }
            }
            if (dz > 300) {
              t.passed = false;
            }
          }
        }
        if (next.duel && next.stageState === "racing" && kart.z >= trackLength - ARCH_LEAD && next.duel.goal[kart.seat] === null) {
          next.duel.goal[kart.seat] = next.tick;
          next.events.push({
            type: "duel-goal",
            seat: kart.seat
          });
        }
        const fork = next.duel ? null : currentStage.fork;
        if (fork && isPlayer) {
          const segIdx = Math.floor(kart.z / currentStage.segmentLength);
          if (next.stageState === "racing" && kart.z >= trackLength - ARCH_LEAD) {
            next.stageState = "checkpoint";
            next.timeRemaining += CHECKPOINT_S;
            next.nextStageId = kart.x < 0 ? fork.leftBranch : fork.rightBranch;
            next.events.push({
              type: "checkpoint-extended",
              stageId: next.nextStageId,
              timeBonus: CHECKPOINT_S
            });
          }
          if (segIdx >= fork.forkSegment && !next.forkActive) {
            next.forkActive = true;
            next.events.push({
              type: "fork-approach",
              leftLabel: fork.leftLabel,
              rightLabel: fork.rightLabel
            });
          }
        }
        if (kart.z >= trackLength) {
          if (!isPlayer) {
            if (kart.id === next.rival.kartId && !next.rival.beaten) next.rival.escaped = true;
            kart.z -= trackLength;
          } else if (fork) {
            const selectedStageId = next.nextStageId;
            if (!selectedStageId) throw new Error("simulation: the road ended with no stage announced at the arch");
            next.stageClear = {
              stageNum: next.stageNum,
              rival: next.rival.beaten ? "beaten" : "ahead"
            };
            next.stageId = selectedStageId;
            next.stageNum++;
            next.routeHistory.push(selectedStageId);
            const nextStageConfig = OUTRUN_STAGES[selectedStageId];
            next.trackName = nextStageConfig.name;
            next.trackLength = nextStageConfig.segmentCount * nextStageConfig.segmentLength;
            next.segmentCount = nextStageConfig.segmentCount;
            next.forkActive = false;
            next.departTimer = DEPART_TICKS;
            kart.z -= trackLength;
            kart.currentLap = next.stageNum;
            next.traffic = spawnTraffic(nextStageConfig, next.seed + next.stageNum * 997, HANDOVER_CLEAR);
            placeRival(next);
          } else {
            kart.z = trackLength;
            next.winnerId = kart.id;
            next.stageState = "finished";
            next.parkedAt = null;
            next.timeBonus = Math.round(next.timeRemaining * 1e3);
            next.score = totalScore(next);
            next.events.push({
              type: "race-finish",
              winnerId: kart.id,
              score: next.score
            });
          }
        }
        if (isPlayer) {
          next.metresDriven += kart.speed * KMH_TO_UNITS_PER_TICK * METRES_PER_UNIT;
        }
      }
      next.karts.forEach((kart, k) => {
        kart.body = springBody(state.karts[k], kart);
      });
      for (const [k, kart] of next.karts.entries()) {
        if (!kart.isPlayer) continue;
        const moment = next.events.some((e) => WAVE_EVENTS.has(e.type)) || kart.isNitro && !state.karts[k].isNitro;
        kart.waveTimer = moment ? WAVE_TICKS : Math.max(0, (kart.waveTimer ?? 0) - 1);
      }
      if (next.duel) return endDuel(next);
      const player = next.karts.find((k) => k.isPlayer);
      const rival = next.karts.find((k) => k.id === next.rival.kartId);
      if (!next.rival.beaten && !next.rival.escaped && player.z > rival.z) {
        next.rival.beaten = true;
        next.rivalsBeaten++;
        next.rivalBannerTimer = 120;
        next.events.push({
          type: "rival-beaten",
          kartId: rival.id,
          bonus: RIVAL_POINTS
        });
      }
      next.score = totalScore(next);
      return next;
    },
    saveState(state) {
      return JSON.parse(JSON.stringify(state));
    },
    loadState(snapshot) {
      return JSON.parse(JSON.stringify(snapshot));
    }
  };
  function nitroStatus(kart) {
    const charges = Math.floor(kart.nitroFuel / NITRO_SHOT + 1e-9);
    const state = kart.nitroTimer > 0 ? "boost" : charges > 0 ? "ready" : "charging";
    return {
      state,
      fill: kart.nitroFuel / 100,
      charges
    };
  }
  var clockBudgetS = (stage) => CLOCK_START_S + (stage - 1) * CHECKPOINT_S;
  var MAX_RUN_S = clockBudgetS(FINAL_STAGE);
  var MAX_RACING_TICKS = MAX_RUN_S * 60 + 1;
  var MAX_KMH = Math.max(...Object.values(CHARACTERS).map((c) => c.topSpeed)) + NITRO_KMH + TURBO_KMH;
  var SCORE_CEILING = Math.ceil(MAX_RACING_TICKS * MAX_KMH * KMH_TO_UNITS_PER_TICK * METRES_PER_UNIT * 10) + TRAFFIC_COUNT * (Math.ceil(MAX_RACING_TICKS / 2) + FINAL_STAGE) * CLOSE_PASS_POINTS + FINAL_STAGE * RIVAL_POINTS + MAX_RUN_S * 1e3;

  // apps/apexrun/shell/engine/scenery.js
  var NIGHT_STAGES = /* @__PURE__ */ new Set([
    "metropolis-night"
  ]);
  var hash = (n, seed) => {
    let h = Math.imul(n ^ Math.imul(seed, 668265261), 2654435761);
    h ^= h >>> 15;
    h = Math.imul(h, 2246822507);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967295 * 2 - 1;
  };
  var smooth = (t) => t * t * (3 - 2 * t);
  function noise2(x, y, period, seed) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const at = (i, j) => hash((i % period + period) % period + (j % period + period) % period * 4099, seed);
    const a = at(xi, yi) * (1 - tx) + at(xi + 1, yi) * tx;
    const b = at(xi, yi + 1) * (1 - tx) + at(xi + 1, yi + 1) * tx;
    return a * (1 - ty) + b * ty;
  }
  function fbm2(x, y, period, seed, octaves = 4) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const f = 2 ** o;
      sum += noise2(x * f, y * f, period * f, seed + o * 31) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  }
  function frondTexture(w, h) {
    const pixels = new Uint8Array(w * h * 4);
    const c = (h - 1) / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        const off = Math.abs(y - c) / c;
        const reach = 0.95 * (1 - u ** 1.6) * Math.min(1, u * 6);
        const rib = off < 0.07;
        const leaflet = off < reach && (x * 0.22 + off * 3.2) % 1 < 0.58;
        const k = (y * w + x) * 4;
        if (rib || leaflet) {
          const shade = 0.75 + 0.25 * (1 - off) - 0.15 * u;
          pixels[k] = Math.round((rib ? 120 : 52) * shade);
          pixels[k + 1] = Math.round((rib ? 110 : 128) * shade);
          pixels[k + 2] = Math.round((rib ? 60 : 50) * shade);
          pixels[k + 3] = 255;
        }
      }
    }
    return {
      width: w,
      height: h,
      pixels
    };
  }
  function waveNormals(w, h, seed) {
    const height = (x, y) => Math.sin(x / w * Math.PI * 2 * 3 + y / h * Math.PI * 2) * 0.5 + Math.sin(x / w * Math.PI * 2 * -2 + y / h * Math.PI * 2 * 5) * 0.3 + fbm2(x / w * 8, y / h * 8, 8, seed) * 0.35;
    const pixels = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = height(x + 1, y) - height(x - 1, y);
        const dy = height(x, y + 1) - height(x, y - 1);
        const nx = -dx * 2.2;
        const ny = -dy * 2.2;
        const len = Math.hypot(nx, ny, 1);
        const k = (y * w + x) * 4;
        pixels[k] = Math.round(nx / len * 127.5 + 127.5);
        pixels[k + 1] = Math.round(ny / len * 127.5 + 127.5);
        pixels[k + 2] = Math.round(1 / len * 127.5 + 127.5);
        pixels[k + 3] = 255;
      }
    }
    return {
      width: w,
      height: h,
      pixels
    };
  }
  function brushStrokes(size, seed, strokes = 420) {
    let s = seed >>> 0;
    const rand = () => {
      s = Math.imul(s, 1664525) + 1013904223 >>> 0;
      return s / 4294967296;
    };
    const value = new Float32Array(size * size).fill(0.5);
    for (let n = 0; n < strokes; n++) {
      const cx = rand() * size;
      const cy = rand() * size;
      const angle = 0.5 + (rand() - 0.5) * 1.6;
      const len = size * (0.12 + 0.22 * rand());
      const width = size * (0.025 + 0.045 * rand());
      const bend = (rand() - 0.5) * 0.5;
      const tone = 0.5 + (rand() < 0.5 ? -1 : 1) * (0.08 + 0.14 * rand());
      const load = 0.55 + 0.4 * rand();
      const bristles = 1.5 + rand() * 2;
      const phase = rand() * 6.283;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const reach = Math.ceil(len / 2 + width * 2);
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const u = (dx * ca + dy * sa) / len + 0.5;
          if (u < 0 || u > 1) continue;
          const v = -dx * sa + dy * ca - bend * (u - 0.5) ** 2 * len * 2;
          const half = width * Math.sqrt(Math.sin(Math.PI * u));
          const across = Math.abs(v) / Math.max(half, 1e-3);
          if (across >= 1) continue;
          const edge = 1 - Math.max(0, across - 0.7) / 0.3;
          const streak = 0.8 + 0.2 * Math.sin(v / width * bristles * Math.PI + phase);
          const a = load * edge * streak * (1 - 0.6 * u ** 2);
          const x = ((Math.floor(cx) + dx) % size + size) % size;
          const y = ((Math.floor(cy) + dy) % size + size) % size;
          const i = y * size + x;
          value[i] += (tone - value[i]) * a;
        }
      }
    }
    let mean = 0;
    for (const v of value) mean += v;
    mean /= value.length;
    let dev = 0;
    for (const v of value) dev += (v - mean) ** 2;
    dev = Math.sqrt(dev / value.length);
    const pixels = new Uint8Array(size * size * 4);
    for (let i = 0; i < value.length; i++) {
      const g = Math.round(Math.max(0, Math.min(1, 0.5 + (value[i] - mean) / dev * 0.16)) * 255);
      pixels.set([
        g,
        g,
        g,
        255
      ], i * 4);
    }
    return {
      pixels,
      width: size,
      height: size
    };
  }
  function flowerCarpet(size, seed, colours) {
    let s = seed >>> 0;
    const rand = () => {
      s = Math.imul(s, 1664525) + 1013904223 >>> 0;
      return s / 4294967296;
    };
    const rgb = colours.map((hex) => [
      1,
      3,
      5
    ].map((k) => parseInt(hex.slice(k, k + 2), 16)));
    const leaf = [
      62,
      98,
      46
    ];
    const px = new Float32Array(size * size * 3);
    for (let i = 0; i < size * size; i++) px.set(leaf.map((c) => c * (0.8 + 0.3 * rand())), i * 3);
    const heads = Math.round(size * size / 70);
    for (let n = 0; n < heads; n++) {
      const cx = rand() * size;
      const cy = rand() * size;
      const r = size * (0.02 + 0.025 * rand());
      const col = rgb[Math.floor(rand() * rgb.length)].map((c) => c * (0.85 + 0.25 * rand()));
      const reach = Math.ceil(r);
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const d = Math.hypot(dx, dy) / r;
          if (d >= 1) continue;
          const a = Math.min(1, (1 - d) * 3);
          const lit = 0.85 + 0.25 * (-(dx + dy) / (2 * r));
          const x = ((Math.floor(cx) + dx) % size + size) % size;
          const y = ((Math.floor(cy) + dy) % size + size) % size;
          const i = (y * size + x) * 3;
          for (let c = 0; c < 3; c++) px[i + c] += (col[c] * lit - px[i + c]) * a;
        }
      }
    }
    const pixels = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) pixels.set([
      ...px.subarray(i * 3, i * 3 + 3)
    ].map((v) => Math.max(0, Math.min(255, Math.round(v)))).concat(255), i * 4);
    return {
      pixels,
      width: size,
      height: size
    };
  }

  // apps/apexrun/shell/engine/effects.js
  var clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v));
  var named = (name) => name.replace(/\s*\[.*\]/, "").toUpperCase();
  var TRIP_TITLE = [
    0.2,
    2.8
  ];
  var STAGE_TITLE = [
    0.4,
    3.4
  ];
  var FADE = 0.4;
  var shown = (t, [from, to]) => clamp(0, Math.min((t - from) / FADE, (to - t) / FADE), 1);
  function replayMoments(state, cut) {
    const t = (state.tick - cut.from) / 60;
    return {
      haze: 0,
      trip: cut.index === 0 ? Math.round(shown(t, TRIP_TITLE) * 20) / 20 : 0,
      stage: {
        num: state.stageNum,
        name: named(state.trackName),
        alpha: Math.round(shown(t, STAGE_TITLE) * 20) / 20
      },
      cut: `${cut.index + 1} / ${cut.count}`
    };
  }
  function moments(state) {
    const player = state.karts.find((k) => k.isPlayer) ?? state.karts[0];
    const handover = state.stageState === "checkpoint";
    const departing = handover && state.departTimer > 0;
    const ended = state.stageState === "finished" || state.stageState === "game_over";
    const arriving = handover && !departing ? Math.max(0, 1 - (state.trackLength - player.z) / (ARCH_LEAD * 0.2)) : 0;
    const leaving = departing ? Math.max(0, (state.departTimer - DEPART_TICKS * 0.85) / (DEPART_TICKS * 0.15)) : 0;
    let count = null;
    if (state.countdown > 0 && state.countdown <= COUNTDOWN_TICKS) count = String(Math.ceil(state.countdown / 60));
    else if (state.stageState === "racing" && state.goTimer > 0) count = "GO!";
    else if (ended && state.endTicks < END_HOLD_TICKS) count = state.stageState === "finished" ? "GOAL!" : "TIME OVER";
    let clear = null;
    if (handover) {
      const cleared = departing ? state.stageClear : {
        stageNum: state.stageNum,
        rival: state.rival.beaten ? "beaten" : "ahead"
      };
      const next = departing ? {
        num: state.stageNum,
        name: state.trackName
      } : {
        num: state.stageNum + 1,
        name: OUTRUN_STAGES[state.nextStageId].name
      };
      clear = {
        stage: cleared.stageNum,
        beaten: cleared.rival === "beaten",
        next: `NEXT \xB7 STAGE ${next.num} \xB7 ${named(next.name)}`,
        skip: departing
      };
    }
    return {
      haze: Math.max(arriving, leaving) ** 2,
      swoop: state.stageState === "warmup" && state.countdown > COUNTDOWN_TICKS ? {
        num: state.stageNum,
        name: named(state.trackName)
      } : null,
      count,
      clear,
      pass: state.closePassBannerTimer > 0 ? {
        bonus: state.closePassBonus,
        t: (CLOSE_PASS_BANNER_TICKS - state.closePassBannerTimer) / CLOSE_PASS_BANNER_TICKS
      } : null,
      rival: state.rivalBannerTimer > 0
    };
  }

  // apps/apexrun/shell/engine/scatter.js
  var NEAR_BAND = [
    0.3,
    5
  ];
  var MID_BAND = [
    5,
    25
  ];
  var MID_SHARE = 0.25;
  var CLUSTER = [
    3,
    7
  ];
  var CLUSTER_RADIUS = 1.6;
  var SCATTER_SIZE = {
    bush: [
      0.5,
      1.1
    ],
    tuft: [
      0.4,
      0.8
    ],
    flower: [
      0.2,
      0.38
    ],
    drift: [
      0.8,
      1.5
    ],
    stone: [
      0.3,
      0.7
    ],
    cactus: [
      1.6,
      3.6
    ],
    poppies: [
      0.55,
      1
    ]
  };
  var lush = (deep, light, flowers) => [
    {
      kind: "bush",
      colour: deep,
      perMetre: 0.2
    },
    {
      kind: "tuft",
      colour: light,
      perMetre: 0.35
    },
    ...flowers.map((colour) => ({
      kind: "flower",
      colour,
      perMetre: 0.55 / flowers.length
    }))
  ];
  var dry = (sage, ochre, flower) => [
    {
      kind: "bush",
      colour: sage,
      perMetre: 0.25
    },
    {
      kind: "tuft",
      colour: ochre,
      perMetre: 0.3
    },
    {
      kind: "flower",
      colour: flower,
      perMetre: 0.3
    },
    {
      kind: "stone",
      colour: "#B5653A",
      perMetre: 0.15
    },
    {
      kind: "cactus",
      colour: "#3E6B33",
      perMetre: 0.12
    }
  ];
  var VERGE_SCATTER = {
    "coconut-beach": lush("#2F6B2E", "#6FA83A", [
      "#E2452B",
      "#F2A33A",
      "#F7E8D0"
    ]),
    // The concept's desert verge is dense low green scrub; its saguaros are the pack's.
    "desert-canyons": [
      {
        kind: "bush",
        colour: "#5E7E3A",
        perMetre: 0.35
      },
      {
        kind: "bush",
        colour: "#7E9446",
        perMetre: 0.2
      },
      {
        kind: "tuft",
        colour: "#9AA050",
        perMetre: 0.25
      },
      {
        kind: "flower",
        colour: "#E8C23A",
        perMetre: 0.15
      },
      {
        kind: "stone",
        colour: "#A8553A",
        perMetre: 0.05
      }
    ],
    "gateway-pass": lush("#2E5A2A", "#5E8F35", [
      "#9B6FC9",
      "#F2E8DA"
    ]),
    "alpine-peaks": [
      // The concept's snow lies in soft continuous banks along the verge.
      {
        kind: "drift",
        colour: "#EEF3F7",
        perMetre: 0.85
      },
      {
        kind: "bush",
        colour: "#24472E",
        perMetre: 0.15
      },
      {
        kind: "tuft",
        colour: "#4E6E3A",
        perMetre: 0.2
      }
    ],
    "wilderness-run": lush("#264F25", "#4F7F2E", [
      "#F2E8DA",
      "#E8C23A"
    ]),
    // The concept's road runs between dense painted poppies, orange heads up
    // to the asphalt, before the tulip rows.
    "tulip-gardens": [
      {
        kind: "poppies",
        colour: "#E8581A",
        perMetre: 0.8
      },
      {
        kind: "poppies",
        colour: "#C8302A",
        perMetre: 0.2
      },
      {
        kind: "tuft",
        colour: "#6E8A52",
        perMetre: 0.25
      }
    ],
    "sunset-highway": dry("#8FA448", "#CC9A48", "#E8A23A"),
    "ancient-ruins": lush("#3A6630", "#7A9A45", [
      "#E2452B",
      "#F2E8DA"
    ]),
    "metropolis-night": [],
    "coastal-cliffs": lush("#2E5A2E", "#5E8F3A", [
      "#F2E8DA",
      "#E8C23A",
      "#9B6FC9"
    ]),
    "destination-marina": lush("#2F6B2E", "#6FA83A", [
      "#E2452B",
      "#F7E8D0"
    ]),
    "destination-oasis": dry("#5E8A3A", "#A8B04A", "#E2452B"),
    "destination-castle": lush("#2E5A2A", "#5E8F35", [
      "#E25A8C",
      "#F2E8DA"
    ]),
    "destination-colosseum": lush("#4E6E30", "#8A9A45", [
      "#E2452B",
      "#E8C23A"
    ]),
    "destination-aerodrome": lush("#3A6A2E", "#6E9A3A", [
      "#F2E8DA",
      "#E8C23A"
    ])
  };
  function scatterVerge(stageId, count, segLen) {
    const look = STAGE_LOOKS[stageId];
    const seed = [
      ...stageId
    ].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) ^ 23719;
    const out = [];
    VERGE_SCATTER[stageId].forEach(({ kind, perMetre }, k) => {
      const rand = createPrng(seed + k * 104729);
      const [lo, hi] = SCATTER_SIZE[kind];
      const perCluster = (CLUSTER[0] + CLUSTER[1]) / 2;
      for (let i = 0; i < count - 1; i++) {
        for (const side of [
          -1,
          1
        ]) {
          const wet = look.water && look.water.side === "left" === side < 0;
          const clusters = Math.floor(perMetre * segLen / perCluster + rand());
          for (let c = 0; c < clusters; c++) {
            const [a, b] = rand() < MID_SHARE ? MID_BAND : NEAR_BAND;
            const centre = a + rand() * (b - a);
            const at = rand();
            const n = CLUSTER[0] + Math.floor(rand() * (CLUSTER[1] - CLUSTER[0] + 1));
            for (let m = 0; m < n; m++) {
              const offset = Math.min(MID_BAND[1], Math.max(NEAR_BAND[0], centre + (rand() - 0.5) * 2 * CLUSTER_RADIUS));
              const along = Math.min(0.999, Math.max(0, at + (rand() - 0.5) * 2 * CLUSTER_RADIUS / segLen));
              const size = lo + rand() * (hi - lo);
              const yaw = kind === "drift" ? (rand() - 0.5) * 0.4 : rand() * Math.PI * 2;
              if (wet && offset > SHORE - 4) continue;
              out.push({
                k,
                kind,
                i,
                along,
                side,
                offset,
                size,
                yaw
              });
            }
          }
        }
      }
    });
    return out;
  }

  // apps/apexrun/shell/engine/art.js
  var LOD_SIZE = 6;
  var LOD_FAR = 520;
  var LOD_SPLITS = [
    70,
    200
  ];
  var ROAD_ALBEDO = 2.4;
  var KIND_HEIGHT = {
    palm: 14,
    shrub: 1.3,
    grassTuft: 0.5,
    mesa: 55,
    cactus: 4.6,
    rock: 1.4,
    pine: 15,
    broadleaf: 9,
    powerPole: 9,
    column: 6,
    cliff: 24,
    cypress: 11,
    windmill: 20,
    brokenArch: 10,
    tower: 60,
    streetLamp: 8,
    lighthouse: 26,
    sailboat: 12.5,
    castleTower: 30,
    colosseum: 47.5,
    hangar: 13,
    rockArch: 46,
    seaArch: 26,
    chapelAlpine: 30,
    chapelTuscan: 34,
    clockTower: 40,
    kasbah: 30,
    aqueduct: 26,
    spire: 150,
    butte: 80,
    greatTree: 30,
    greatWindmill: 40
  };
  var SET_SIZED = /* @__PURE__ */ new Set([
    "rock"
  ]);
  function modelScales(manifest, kind, ids) {
    const heights = ids.map((id) => artEntry(manifest, `model/${id}/lod0`).bounds_m[1][1]);
    const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
    return heights.map((h) => KIND_HEIGHT[kind] / (SET_SIZED.has(kind) ? mean : h));
  }
  var MODEL_TURN = {
    hangar: -Math.PI / 2,
    "tower-b": Math.PI / 2,
    aqueduct: Math.PI / 2,
    "sea-arch": Math.PI / 2
  };
  var palms = [
    "palm-a",
    "palm-b",
    "palm-c"
  ];
  var sandstone = [
    "rock-sand-a",
    "rock-sand-b",
    "rock-sand-c",
    "rock-sand-d",
    "rock-sand-e",
    "rock-sand-f"
  ];
  var granite = [
    "rock-granite-a",
    "rock-granite-b",
    "rock-granite-c",
    "rock-granite-d",
    "rock-granite-e"
  ];
  var limestone = [
    "rock-lime-a",
    "rock-lime-b",
    "rock-lime-c",
    "rock-lime-d"
  ];
  var STAGE_ART = {
    "coconut-beach": {
      sky: "coconut-beach",
      ground: "grass",
      flagman: true,
      seaWall: true,
      models: {
        palm: palms,
        shrub: [
          "shrub-tropical"
        ],
        grassTuft: [
          "grass-beach"
        ],
        sailboat: [
          "sailboat"
        ],
        lighthouse: [
          "lighthouse"
        ],
        cliff: [
          "cliff-coast-a",
          "cliff-coast-b"
        ],
        rock: [
          ...granite,
          ...limestone
        ]
      }
    },
    "desert-canyons": {
      sky: "desert-canyons",
      ground: "sand-desert",
      models: {
        rockArch: [
          "rock-arch"
        ],
        mesa: [
          "mesa-a",
          "mesa-b"
        ],
        cactus: [
          "cactus"
        ],
        rock: sandstone,
        shrub: [
          "shrub-desert"
        ]
      }
    },
    "gateway-pass": {
      sky: "gateway-pass",
      ground: "grass",
      models: {
        chapelTuscan: [
          "chapel-tuscan"
        ],
        cypress: [
          "cypress"
        ],
        rock: [
          ...granite,
          ...limestone
        ],
        grassTuft: [
          "grass-tuft"
        ]
      }
    },
    "alpine-peaks": {
      sky: "alpine-peaks",
      ground: "snow",
      models: {
        chapelAlpine: [
          "chapel-alpine"
        ],
        pine: [
          "tree-fir-a",
          "tree-fir-b",
          "tree-pine-young"
        ],
        rock: granite
      }
    },
    "wilderness-run": {
      sky: "wilderness-run",
      ground: "forest-floor",
      models: {
        greatTree: [
          "tree-broadleaf-a"
        ],
        broadleaf: [
          "tree-broadleaf-a",
          "tree-broadleaf-b"
        ],
        shrub: [
          "shrub-b",
          "fern"
        ],
        grassTuft: [
          "grass-tuft"
        ]
      }
    },
    "tulip-gardens": {
      sky: "tulip-gardens",
      ground: "tulip-field",
      groundTile: 16,
      carpet: [
        "#E8581A",
        "#E8581A",
        "#C8302A"
      ],
      models: {
        greatWindmill: [
          "windmill"
        ],
        windmill: [
          "windmill"
        ],
        powerPole: [
          "power-pole"
        ],
        grassTuft: [
          "grass-tuft"
        ],
        broadleaf: [
          "tree-broadleaf-a",
          "tree-broadleaf-b"
        ]
      }
    },
    "sunset-highway": {
      sky: "sunset-highway",
      ground: "sand-desert",
      groundTint: [
        0.86,
        0.92,
        1
      ],
      models: {
        butte: [
          "mesa-a"
        ],
        powerPole: [
          "power-pole"
        ],
        rock: sandstone,
        shrub: [
          "shrub-desert"
        ]
      }
    },
    "ancient-ruins": {
      sky: "ancient-ruins",
      ground: "grass",
      models: {
        aqueduct: [
          "aqueduct"
        ],
        column: [
          "column"
        ],
        brokenArch: [
          "broken-arch"
        ],
        rock: limestone,
        grassTuft: [
          "grass-tuft"
        ]
      }
    },
    "metropolis-night": {
      sky: "metropolis-night",
      ground: "cobble",
      models: {
        spire: [
          "tower-a"
        ],
        tower: [
          "tower-a",
          "tower-b",
          "tower-c"
        ],
        streetLamp: [
          "street-lamp"
        ]
      },
      exposure: 2,
      skyLight: 0.35
    },
    "coastal-cliffs": {
      sky: "coconut-beach",
      ground: "grass",
      models: {
        seaArch: [
          "sea-arch"
        ],
        cliff: [
          "cliff-coast-a",
          "cliff-coast-b"
        ],
        lighthouse: [
          "lighthouse"
        ],
        rock: [
          ...granite,
          ...limestone
        ],
        grassTuft: [
          "grass-tuft"
        ]
      }
    },
    "destination-marina": {
      sky: "coconut-beach",
      ground: "sand-beach",
      models: {
        clockTower: [
          "clock-tower"
        ],
        sailboat: [
          "sailboat"
        ],
        palm: palms
      }
    },
    "destination-oasis": {
      sky: "desert-canyons",
      ground: "sand-desert",
      models: {
        kasbah: [
          "kasbah"
        ],
        palm: palms,
        rock: sandstone
      }
    },
    "destination-castle": {
      sky: "wilderness-run",
      ground: "grass",
      models: {
        castleTower: [
          "castle-tower"
        ],
        cypress: [
          "cypress"
        ],
        rock: limestone,
        shrub: [
          "shrub-b"
        ],
        grassTuft: [
          "grass-tuft"
        ]
      }
    },
    "destination-colosseum": {
      sky: "ancient-ruins",
      ground: "ruins-stone",
      models: {
        colosseum: [
          "colosseum"
        ],
        column: [
          "column"
        ],
        shrub: [
          "shrub-b"
        ]
      }
    },
    "destination-aerodrome": {
      sky: "tulip-gardens",
      ground: "grass",
      models: {
        hangar: [
          "hangar"
        ],
        grassTuft: [
          "grass-tuft"
        ]
      }
    }
  };
  function artEntry(manifest, id) {
    const entry = manifest[id];
    if (!entry) throw new Error(`art: the manifest has no ${id}`);
    return entry;
  }
  var BACKDROP_LAYERS = [
    "far",
    "mid"
  ];

  // apps/apexrun/assets/manifest.json
  var manifest_default = {
    "backdrop/alpine-peaks.far": {
      bytes: 37182,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "dc2a355272c7995a0bde2bd1814582d1996f38c8c2594c4719eb96e04ab3213c.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "dc2a355272c7995a0bde2bd1814582d1996f38c8c2594c4719eb96e04ab3213c",
      source: {
        generated: {
          colours: [
            "#6E7E9E",
            "#E8EEF4"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/alpine-peaks.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.75
          },
          profile: "peaks",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant soft rounded snow-covered mountain range, gentle violet shade",
          seed: 7213,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/alpine-peaks.mid": {
      bytes: 35032,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "1bffe80a4f7f153e664d6d03732557fea67171817224a82aebdbb452c691ab01.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "1bffe80a4f7f153e664d6d03732557fea67171817224a82aebdbb452c691ab01",
      source: {
        generated: {
          colours: [
            "#1E3E2C",
            "#3E6A44"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/alpine-peaks.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            bumps: 70,
            h: 0.5,
            spikes: 1
          },
          profile: "treeline",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, dense dark fir forest ridge with snow",
          seed: 7244,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/ancient-ruins.far": {
      bytes: 21392,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "05f532ca3f5bd3b26932b6ecf1f8b196944e267ee781bb3ce38518f5c6442bb7.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "05f532ca3f5bd3b26932b6ecf1f8b196944e267ee781bb3ce38518f5c6442bb7",
      source: {
        generated: {
          colours: [
            "#6E7E6A",
            "#9AA48A"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/ancient-ruins.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.42,
            seed: 7
          },
          profile: "hills",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant olive hills with cypress",
          seed: 1367,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/ancient-ruins.mid": {
      bytes: 31984,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "4e24443709e30de7cf02d70072eb6b26abc6d1f8df3198770faaeedf2d43c9da.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "4e24443709e30de7cf02d70072eb6b26abc6d1f8df3198770faaeedf2d43c9da",
      source: {
        generated: {
          colours: [
            "#3E5A30",
            "#6E8A44"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/ancient-ruins.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            bumps: 50,
            h: 0.34,
            spikes: 0.5
          },
          profile: "treeline",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, olive groves and cypress on mediterranean hills",
          seed: 1398,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/coastal-cliffs.far": {
      bytes: 19382,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "84399067f6cb7c0f9baac259ea6607032acb2ba88aac585b33c4f2fb07c7cf3c.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "84399067f6cb7c0f9baac259ea6607032acb2ba88aac585b33c4f2fb07c7cf3c",
      source: {
        generated: {
          colours: [
            "#5A6E6A",
            "#8A9A88"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/coconut-beach.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.5,
            seed: 8
          },
          profile: "bluffs",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant sea cliffs and headlands",
          seed: 3692,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/coastal-cliffs.mid": {
      bytes: 16936,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "5900b12ee6100ebe8f9b6946f41ae5d08d4f6541e4f042ffefb5add39b92dc2d.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "5900b12ee6100ebe8f9b6946f41ae5d08d4f6541e4f042ffefb5add39b92dc2d",
      source: {
        generated: {
          colours: [
            "#3E6A34",
            "#6E9A4A"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/coconut-beach.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.3,
            seed: 19
          },
          profile: "hills",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, green clifftop meadows and hedgerows",
          seed: 3723,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/coconut-beach.far": {
      bytes: 14758,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "eb895ea8919b22f153466bf0cecd0d2a3974b941829b12af56d63667655c71e6.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "eb895ea8919b22f153466bf0cecd0d2a3974b941829b12af56d63667655c71e6",
      source: {
        generated: {
          colours: [
            "#5E7A6A",
            "#8FA48A"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/coconut-beach.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.42
          },
          profile: "bluffs",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant green coastal headlands and bluffs over a calm sea",
          seed: 220,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/coconut-beach.mid": {
      bytes: 29790,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "417e3acf2ff83e413de8e5b3f5db412071651236d428719439fc8e054feddd80.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "417e3acf2ff83e413de8e5b3f5db412071651236d428719439fc8e054feddd80",
      source: {
        generated: {
          colours: [
            "#2F6B35",
            "#5E9A48"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/coconut-beach.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            bumps: 34,
            h: 0.4,
            spikes: 0
          },
          profile: "treeline",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, lush tropical tree line with palms along a beach",
          seed: 251,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/desert-canyons.far": {
      bytes: 24882,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "f0494aef655ce5378f2020c26a4e46a85e73fefbc6d16b04e1b590983fe6e3aa.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "f0494aef655ce5378f2020c26a4e46a85e73fefbc6d16b04e1b590983fe6e3aa",
      source: {
        generated: {
          colours: [
            "#B65A3A",
            "#D9925E"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/desert-canyons.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.5
          },
          profile: "buttes",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant red sandstone mesas and buttes, layered strata",
          seed: 4808,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/desert-canyons.mid": {
      bytes: 19922,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "23930ff0b65d7f7c3bd37608163dc3ac0364097d43021e53043a41f1476274f7.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "23930ff0b65d7f7c3bd37608163dc3ac0364097d43021e53043a41f1476274f7",
      source: {
        generated: {
          colours: [
            "#A84A2E",
            "#C9784A"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/desert-canyons.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.36,
            seed: 9
          },
          profile: "buttes",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, red rock mesas and canyon walls",
          seed: 4839,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/destination-aerodrome.far": {
      bytes: 10262,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "3ea4aad9b184822dcf1c8733ba52631e9c636c2f3253d92db568c0e9a7999472.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "3ea4aad9b184822dcf1c8733ba52631e9c636c2f3253d92db568c0e9a7999472",
      source: {
        generated: {
          colours: [
            "#6A7E8A",
            "#9AAAB0"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/tulip-gardens.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.28,
            seed: 17
          },
          profile: "hills",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant low hills",
          seed: 7562,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/destination-aerodrome.mid": {
      bytes: 28010,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "b5f01ca7378e52e4f3ff7b151e57627fcfe336a4e66701be2929ff9a315ac21b.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "b5f01ca7378e52e4f3ff7b151e57627fcfe336a4e66701be2929ff9a315ac21b",
      source: {
        generated: {
          colours: [
            "#3A6030",
            "#6A9040"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/tulip-gardens.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            bumps: 40,
            h: 0.22,
            spikes: 0.2
          },
          profile: "treeline",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, airfield hedgerows and tree lines",
          seed: 7593,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/destination-castle.far": {
      bytes: 20944,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "9ab17e507cc3d9e03240e5afa09b26e55329b40ad491760d6b5df0ec90083ef2.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "9ab17e507cc3d9e03240e5afa09b26e55329b40ad491760d6b5df0ec90083ef2",
      source: {
        generated: {
          colours: [
            "#5A6E8A",
            "#8A9AB0"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/wilderness-run.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.5,
            seed: 15
          },
          profile: "hills",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant blue hills with a far castle",
          seed: 7580,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/destination-castle.mid": {
      bytes: 30976,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "e2138e8eed3e5e6607230f04f798e18c9ffe2b0968eaa99203127a7cdb9d83e7.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "e2138e8eed3e5e6607230f04f798e18c9ffe2b0968eaa99203127a7cdb9d83e7",
      source: {
        generated: {
          colours: [
            "#2E5A30",
            "#5A8A44"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/wilderness-run.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            bumps: 50,
            h: 0.34,
            spikes: 0.3
          },
          profile: "treeline",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, green forest and hedgerow hills",
          seed: 7611,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/destination-colosseum.far": {
      bytes: 20974,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "b2841bbdd26f3fb6238b99175facdea14470f5cf138012dff44e694ba76b91e4.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "b2841bbdd26f3fb6238b99175facdea14470f5cf138012dff44e694ba76b91e4",
      source: {
        generated: {
          colours: [
            "#7A7A6A",
            "#A8A48A"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/ancient-ruins.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.38,
            seed: 16
          },
          profile: "hills",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant roman hills with pines",
          seed: 8430,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/destination-colosseum.mid": {
      bytes: 30856,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "40eb8a74179b1025cb9d3c65c5eead3d70944345456bd427c10c95c5b759025d.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "40eb8a74179b1025cb9d3c65c5eead3d70944345456bd427c10c95c5b759025d",
      source: {
        generated: {
          colours: [
            "#3E5A30",
            "#6E8A44"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/ancient-ruins.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            bumps: 30,
            h: 0.3,
            spikes: 0.2
          },
          profile: "treeline",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, umbrella pines and cypress",
          seed: 8461,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/destination-marina.far": {
      bytes: 14896,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "3ba751f3ce333e8d1b91336eae86a95822b3c30e395f3c6739493635ddd911e1.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "3ba751f3ce333e8d1b91336eae86a95822b3c30e395f3c6739493635ddd911e1",
      source: {
        generated: {
          colours: [
            "#5E7A7A",
            "#8EA4A4"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/coconut-beach.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.36,
            seed: 11
          },
          profile: "bluffs",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant coastal hills over a harbour",
          seed: 7456,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/destination-marina.mid": {
      bytes: 25946,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "1174a86045b91cec1cd04883e06fe130daba23140f96d33f1e4caf7162de486c.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "1174a86045b91cec1cd04883e06fe130daba23140f96d33f1e4caf7162de486c",
      source: {
        generated: {
          colours: [
            "#2E6A3E",
            "#5E9A54"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/coconut-beach.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            bumps: 36,
            h: 0.26,
            spikes: 0
          },
          profile: "treeline",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, harbour town trees and palms",
          seed: 7487,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/destination-oasis.far": {
      bytes: 19384,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "a9066ac194015987f3a81512c4ea3b84a7284a99d60b9c4333cb7cca0f8d6828.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "a9066ac194015987f3a81512c4ea3b84a7284a99d60b9c4333cb7cca0f8d6828",
      source: {
        generated: {
          colours: [
            "#B8885A",
            "#D8B080"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/desert-canyons.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.3,
            seed: 12
          },
          profile: "hills",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant golden sand dunes",
          seed: 4697,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/destination-oasis.mid": {
      bytes: 27148,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "f010ccb4d541934cdfd27c51c35fd2dae0bb083328d554bc3f5d8c382e63b0b4.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "f010ccb4d541934cdfd27c51c35fd2dae0bb083328d554bc3f5d8c382e63b0b4",
      source: {
        generated: {
          colours: [
            "#3E6A2E",
            "#6E9A3E"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/desert-canyons.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            bumps: 24,
            h: 0.32,
            spikes: 0
          },
          profile: "treeline",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, date palm oasis grove",
          seed: 4728,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/gateway-pass.far": {
      bytes: 20850,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "d212abc86c9be9463a37d61cd87829ddb4253e2c3f0d28ba19e320cd39958e27.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "d212abc86c9be9463a37d61cd87829ddb4253e2c3f0d28ba19e320cd39958e27",
      source: {
        generated: {
          colours: [
            "#5E7E9A",
            "#8EA4B4"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/gateway-pass.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.5
          },
          profile: "hills",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant blue mountain ridges",
          seed: 8081,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/gateway-pass.mid": {
      bytes: 32412,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "c8c7e6c9792d1eb9d7ba38f198ebdc2e5993ce5b0d2fcf6786d3538d9db1a2e4.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "c8c7e6c9792d1eb9d7ba38f198ebdc2e5993ce5b0d2fcf6786d3538d9db1a2e4",
      source: {
        generated: {
          colours: [
            "#264F2E",
            "#4E7A3A"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/gateway-pass.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            bumps: 60,
            h: 0.32,
            spikes: 0.6
          },
          profile: "treeline",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, tall dark cypress and pine treeline on green hills",
          seed: 8112,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/metropolis-night.far": {
      bytes: 88560,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "ea0fce64882c0394754089718b80e9c404a9dfc4646c920b174703437e9a492f.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "ea0fce64882c0394754089718b80e9c404a9dfc4646c920b174703437e9a492f",
      source: {
        generated: {
          colours: [
            "#141428",
            "#2E2E52"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/metropolis-night.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.7
          },
          profile: "skyline",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant city skyline at night with glowing windows",
          seed: 1938,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/metropolis-night.mid": {
      bytes: 59962,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "cc069690e31b303203e24e72ce7778b03a3ad15cac15e70918b8d9813e97177a.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "cc069690e31b303203e24e72ce7778b03a3ad15cac15e70918b8d9813e97177a",
      source: {
        generated: {
          colours: [
            "#1A1A30",
            "#3A3A5E"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/metropolis-night.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.45,
            seed: 21
          },
          profile: "skyline",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, city towers at night with lit windows",
          seed: 1969,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/sunset-highway.far": {
      bytes: 24870,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "b2b673dc3a63f73ebbf3f62c95a4b395b1d24a51a91cfae462715cbe5622b25a.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "b2b673dc3a63f73ebbf3f62c95a4b395b1d24a51a91cfae462715cbe5622b25a",
      source: {
        generated: {
          colours: [
            "#8E4A4A",
            "#C97A5A"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/sunset-highway.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.38,
            seed: 13
          },
          profile: "buttes",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant desert mesas in warm sunset light",
          seed: 5335,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/sunset-highway.mid": {
      bytes: 20148,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "a013a4ca9ccad9c68a2f4ee05efcf628560013be79402b1b8d603e98b164289d.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "a013a4ca9ccad9c68a2f4ee05efcf628560013be79402b1b8d603e98b164289d",
      source: {
        generated: {
          colours: [
            "#7A5A3E",
            "#A87E52"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/sunset-highway.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.24,
            seed: 14
          },
          profile: "hills",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, low desert hills with scrub",
          seed: 5366,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/tulip-gardens.far": {
      bytes: 10162,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "7d72abecdedf67e35ef52f135246064ef75ca2f3976327cc86f3ce77e7e3f95a.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "7d72abecdedf67e35ef52f135246064ef75ca2f3976327cc86f3ce77e7e3f95a",
      source: {
        generated: {
          colours: [
            "#6E8A6E",
            "#9AB08A"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/tulip-gardens.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.16,
            seed: 6
          },
          profile: "hills",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant flat green polder with tree rows",
          seed: 1336,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/tulip-gardens.mid": {
      bytes: 39812,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "02412eb5c38428d2c6be1686fc06a755f3b27b7da2ee6daebcb785b3e99c03e1.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "02412eb5c38428d2c6be1686fc06a755f3b27b7da2ee6daebcb785b3e99c03e1",
      source: {
        generated: {
          colours: [
            "#4E6E3E",
            "#7E9A5A"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/tulip-gardens.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.42
          },
          profile: "windmills",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, dutch windmills and tree rows over flat fields",
          seed: 1367,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/wilderness-run.far": {
      bytes: 20546,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "f5c6f3df657459c633de09ed0a4e710ff9f90ea84e7efd900ef4e0fa63dfe76d.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "f5c6f3df657459c633de09ed0a4e710ff9f90ea84e7efd900ef4e0fa63dfe76d",
      source: {
        generated: {
          colours: [
            "#4E6E7E",
            "#7E9AA4"
          ],
          guidance: 7.5,
          haze: 0.5,
          horizon_from: "sky/wilderness-run.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            h: 0.55,
            seed: 4
          },
          profile: "hills",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, distant forested mountains in blue haze",
          seed: 5397,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "backdrop/wilderness-run.mid": {
      bytes: 34784,
      channels: "RGBA",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 88,
        size: [
          2048,
          512
        ]
      },
      file: "0393ccb776a7f5bfe1e7be1d6c7442d8517ca2a078ff8021d495303fc3b71fdc.webp",
      kind: "texture",
      license: "CC0",
      note: "painted distance strip, tiles horizontally; alpha is the silhouette; the game undoes ACES and the exposure when drawing it",
      sha256: "0393ccb776a7f5bfe1e7be1d6c7442d8517ca2a078ff8021d495303fc3b71fdc",
      source: {
        generated: {
          colours: [
            "#1E4426",
            "#3E6E34"
          ],
          guidance: 7.5,
          haze: 0.22,
          horizon_from: "sky/wilderness-run.paint.jpg",
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, cars, road, photo, photorealistic, sky clouds in front, frame, border",
          padding: "circular",
          params: {
            bumps: 80,
            h: 0.38,
            spikes: 0.8
          },
          profile: "treeline",
          prompt: "gouache background painting by Kazuo Oga, Studio Ghibli, distant landscape seen across the horizon, opaque layered paint, soft brushwork, warm afternoon light, deep blue-green shade, dense wild forest of firs and broadleaf trees",
          seed: 5428,
          steps: 36,
          strength: 0.78,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "model/aqueduct/lod0": {
      bounds_m: [
        [
          -46,
          -2,
          -7.038465255273787
        ],
        [
          41.360111593852324,
          25.20000000000016,
          4.457802745448422
        ]
      ],
      bytes: 1299428,
      emissive: [],
      file: "9eb4d215a43008090ae43b71b4da1eb3fd0173a2277016b1ac45e395ac930c3e.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/aqueduct/lod0",
        "model/aqueduct/lod1",
        "model/aqueduct/lod2"
      ],
      materials: [
        "stone",
        "moss"
      ],
      nodes: [
        null
      ],
      note: "a Roman aqueduct, 25 m, 87 m long along X: two tiers of round arches under the channel, moss on top, its east end fallen with blocks on the ground; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "9eb4d215a43008090ae43b71b4da1eb3fd0173a2277016b1ac45e395ac930c3e",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "c3b6cd896e9c1660143c156791783d23682ba837907e11e40afe5812ed2a3115.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a ruined roman aqueduct of warm limestone, two tiers of round arches, moss on top",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "aqueduct",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 24e3
    },
    "model/aqueduct/lod1": {
      bounds_m: [
        [
          -46,
          -2,
          -7.03692713830244
        ],
        [
          41.36096534696546,
          25.200000126176135,
          4.457796732050525
        ]
      ],
      bytes: 412376,
      emissive: [],
      file: "cf2fbd0f3964cbf54133e9618c36c5e8bbcedb012a5ef0d62aee6eddbcc3a9c7.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/aqueduct/lod0",
        "model/aqueduct/lod1",
        "model/aqueduct/lod2"
      ],
      materials: [
        "stone",
        "moss"
      ],
      nodes: [
        null
      ],
      note: "a Roman aqueduct, 25 m, 87 m long along X: two tiers of round arches under the channel, moss on top, its east end fallen with blocks on the ground; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "cf2fbd0f3964cbf54133e9618c36c5e8bbcedb012a5ef0d62aee6eddbcc3a9c7",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "d38273a218238dca142327acbb12eeb4c545fd6ccadef9979d4ffa18e569a469.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a ruined roman aqueduct of warm limestone, two tiers of round arches, moss on top",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "aqueduct",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 6e3
    },
    "model/aqueduct/lod2": {
      bounds_m: [
        [
          -46,
          -1.999999999998204,
          -7.0197708646213846
        ],
        [
          41.31549649103267,
          25.2,
          4.430211886269966
        ]
      ],
      bytes: 132488,
      emissive: [],
      file: "3aad2117edecf7a69d1074ee5e6469ed6cfd150c2f4b4846f742844331788e7b.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/aqueduct/lod0",
        "model/aqueduct/lod1",
        "model/aqueduct/lod2"
      ],
      materials: [
        "stone",
        "moss"
      ],
      nodes: [
        null
      ],
      note: "a Roman aqueduct, 25 m, 87 m long along X: two tiers of round arches under the channel, moss on top, its east end fallen with blocks on the ground; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "3aad2117edecf7a69d1074ee5e6469ed6cfd150c2f4b4846f742844331788e7b",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "6b8977f5c9d6d0c21af71ac17e790121b18eab22eb7c6363625801cfc0159238.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a ruined roman aqueduct of warm limestone, two tiers of round arches, moss on top",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "aqueduct",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 1600
    },
    "model/barrier-concrete/lod0": {
      bounds_m: [
        [
          -0.7726785242557526,
          0,
          -0.3193703144788742
        ],
        [
          0.7726785242557526,
          0.8310486022382975,
          0.3193703144788742
        ]
      ],
      build: {
        budget: 4e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 764944,
      file: "4834c2624fc3b0bc77172ea248729e9a970170eaca970ef149f4bdb2a12d665e.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/barrier-concrete/lod0",
        "model/barrier-concrete/lod1",
        "model/barrier-concrete/lod2"
      ],
      sha256: "4834c2624fc3b0bc77172ea248729e9a970170eaca970ef149f4bdb2a12d665e",
      source: {
        polyhaven: {
          id: "concrete_road_barrier",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/concrete_road_barrier/concrete_road_barrier_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 60928
      },
      stages: [
        "road",
        "metropolis-night",
        "sunset-highway"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 1024
      },
      tris: 3998
    },
    "model/barrier-concrete/lod1": {
      bounds_m: [
        [
          -0.7726785242557526,
          0,
          -0.3193703144788742
        ],
        [
          0.7726785242557526,
          0.8310486022382975,
          0.3193703144788742
        ]
      ],
      build: {
        budget: 4e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 186744,
      file: "7913cfa97f7e59e14979f598d9eb538efe57369da91e0ce13fa59ccb2a81eae1.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/barrier-concrete/lod0",
        "model/barrier-concrete/lod1",
        "model/barrier-concrete/lod2"
      ],
      sha256: "7913cfa97f7e59e14979f598d9eb538efe57369da91e0ce13fa59ccb2a81eae1",
      source: {
        polyhaven: {
          id: "concrete_road_barrier",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/concrete_road_barrier/concrete_road_barrier_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 60928
      },
      stages: [
        "road",
        "metropolis-night",
        "sunset-highway"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 512
      },
      tris: 998
    },
    "model/barrier-concrete/lod2": {
      bounds_m: [
        [
          -0.7726785242557526,
          0,
          -0.3193703144788742
        ],
        [
          0.7726785242557526,
          0.8310486022382975,
          0.3193703144788742
        ]
      ],
      build: {
        budget: 4e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 27284,
      file: "42f404167dade19c471df2530eee361e8998800d67ad7c8253b225568905ebaf.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/barrier-concrete/lod0",
        "model/barrier-concrete/lod1",
        "model/barrier-concrete/lod2"
      ],
      sha256: "42f404167dade19c471df2530eee361e8998800d67ad7c8253b225568905ebaf",
      source: {
        polyhaven: {
          id: "concrete_road_barrier",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/concrete_road_barrier/concrete_road_barrier_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 60928
      },
      stages: [
        "road",
        "metropolis-night",
        "sunset-highway"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 256
      },
      tris: 238
    },
    "model/boulder-granite/lod0": {
      bounds_m: [
        [
          -0.7253122579161442,
          0,
          -0.9341177798547324
        ],
        [
          0.72475336698256,
          0.9751317205505377,
          0.9338897702331013
        ]
      ],
      bytes: 55948,
      emissive: [],
      file: "9586ce193dd03b10213d804311f4c1149c118939e542cd3ab5de9956cdee6d90.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/boulder-granite/lod0",
        "model/boulder-granite/lod1",
        "model/boulder-granite/lod2"
      ],
      materials: [
        "granite"
      ],
      nodes: [
        "boulder-granite"
      ],
      note: "granite boulder, 1.0 m: chunky planar facets with rounded edges, a sloping top facet, a smaller block fused at its foot, a V-groove split across the top; material granite (grey-blue); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "9586ce193dd03b10213d804311f4c1149c118939e542cd3ab5de9956cdee6d90",
      source: {
        procedural: {
          builder: "boulder_granite",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run"
      ],
      tris: 2140,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/boulder-granite/lod1": {
      bounds_m: [
        [
          -0.725981381212741,
          0,
          -0.9347504369718739
        ],
        [
          0.7228304475344084,
          0.9750778188966005,
          0.9353867299683558
        ]
      ],
      bytes: 17768,
      emissive: [],
      file: "a71a51334e6a9b3552a6aaa824f0c293beae9c69481b5b71c03dbe5393e61043.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/boulder-granite/lod0",
        "model/boulder-granite/lod1",
        "model/boulder-granite/lod2"
      ],
      materials: [
        "granite"
      ],
      nodes: [
        "boulder-granite"
      ],
      note: "granite boulder, 1.0 m: chunky planar facets with rounded edges, a sloping top facet, a smaller block fused at its foot, a V-groove split across the top; material granite (grey-blue); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "a71a51334e6a9b3552a6aaa824f0c293beae9c69481b5b71c03dbe5393e61043",
      source: {
        procedural: {
          builder: "boulder_granite",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run"
      ],
      tris: 614,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/boulder-granite/lod2": {
      bounds_m: [
        [
          -0.725981381212741,
          0,
          -0.934012032109349
        ],
        [
          0.727111689287939,
          0.9698380588620373,
          0.9216520728839861
        ]
      ],
      bytes: 5420,
      emissive: [],
      file: "950964b9cdc9fafaa1b01533a68bdc78033f3c83c94ef4f18354ed2adfa16301.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/boulder-granite/lod0",
        "model/boulder-granite/lod1",
        "model/boulder-granite/lod2"
      ],
      materials: [
        "granite"
      ],
      nodes: [
        "boulder-granite"
      ],
      note: "granite boulder, 1.0 m: chunky planar facets with rounded edges, a sloping top facet, a smaller block fused at its foot, a V-groove split across the top; material granite (grey-blue); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "950964b9cdc9fafaa1b01533a68bdc78033f3c83c94ef4f18354ed2adfa16301",
      source: {
        procedural: {
          builder: "boulder_granite",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run"
      ],
      tris: 154,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/broken-arch/lod0": {
      bounds_m: [
        [
          -6.308107602362485,
          0,
          -2.0396797867995398
        ],
        [
          6.308107602362485,
          8.290448588938988,
          2.0396797867995398
        ]
      ],
      bytes: 212708,
      emissive: [],
      file: "42a5b4632df4e1c0602a18de92bf86dee76c961d5abf8865259bb6a761abb592.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/broken-arch/lod0",
        "model/broken-arch/lod1",
        "model/broken-arch/lod2"
      ],
      materials: [
        "stone",
        "stone_b"
      ],
      nodes: [
        "broken-arch"
      ],
      note: "passage along Z; the fallen corner is at +X, five of its blocks lie on the ground either side; picked over two Hunyuan arches (work/build/broken-arch-hy3, -hy4), which came out intact and baroque; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "42a5b4632df4e1c0602a18de92bf86dee76c961d5abf8865259bb6a761abb592",
      source: {
        baked: {
          atlas_px: [
            1024,
            512,
            256
          ],
          from: "8e9f08ce7132205db51cb388f1fb716262afe3fd0000afd1a20a9721b4cd85d6.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a weathered roman stone arch ruin, warm limestone",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "broken_arch",
          params: {},
          script: "scripts/arch.py",
          script_sha256: "c7a5e6925d9d49f25aa00f00d5c8c8239cd4efc8b7d7be33a5137212c534c8fb"
        }
      },
      tris: 1104
    },
    "model/broken-arch/lod1": {
      bounds_m: [
        [
          -6.308107602362485,
          0,
          -2.0396797867995398
        ],
        [
          6.308107602362485,
          8.290448588938988,
          2.0396797867995398
        ]
      ],
      bytes: 126188,
      emissive: [],
      file: "b42fa2dec98bf9ccb844efec6ad1aa0e0eace4aff30ea950f6221886d59671ec.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/broken-arch/lod0",
        "model/broken-arch/lod1",
        "model/broken-arch/lod2"
      ],
      materials: [
        "stone",
        "stone_b"
      ],
      nodes: [
        "broken-arch"
      ],
      note: "passage along Z; the fallen corner is at +X, five of its blocks lie on the ground either side; picked over two Hunyuan arches (work/build/broken-arch-hy3, -hy4), which came out intact and baroque; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "b42fa2dec98bf9ccb844efec6ad1aa0e0eace4aff30ea950f6221886d59671ec",
      source: {
        baked: {
          atlas_px: [
            1024,
            512,
            256
          ],
          from: "f0feca892b6da4dd734e2af20707be4d103d555d0b07bde7dcb61708d11a9576.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a weathered roman stone arch ruin, warm limestone",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "broken_arch",
          params: {},
          script: "scripts/arch.py",
          script_sha256: "c7a5e6925d9d49f25aa00f00d5c8c8239cd4efc8b7d7be33a5137212c534c8fb"
        }
      },
      tris: 1040
    },
    "model/broken-arch/lod2": {
      bounds_m: [
        [
          -4.732139959462698,
          0,
          -1.888933816807354
        ],
        [
          4.6678600405373025,
          8.3,
          1.2110661831926461
        ]
      ],
      bytes: 63156,
      emissive: [],
      file: "c5ec585e3cfab6dbea48fbdc96f157e8eb3e35647c360b95a11557de87feaaa2.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/broken-arch/lod0",
        "model/broken-arch/lod1",
        "model/broken-arch/lod2"
      ],
      materials: [
        "stone",
        "stone_b"
      ],
      nodes: [
        "broken-arch"
      ],
      note: "passage along Z; the fallen corner is at +X, five of its blocks lie on the ground either side; picked over two Hunyuan arches (work/build/broken-arch-hy3, -hy4), which came out intact and baroque; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "c5ec585e3cfab6dbea48fbdc96f157e8eb3e35647c360b95a11557de87feaaa2",
      source: {
        baked: {
          atlas_px: [
            1024,
            512,
            256
          ],
          from: "9ef8a5b51e2cbc2fa07bf24609a6963662badef522b374c3e493abb31cb23e27.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a weathered roman stone arch ruin, warm limestone",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "broken_arch",
          params: {},
          script: "scripts/arch.py",
          script_sha256: "c7a5e6925d9d49f25aa00f00d5c8c8239cd4efc8b7d7be33a5137212c534c8fb"
        }
      },
      tris: 600
    },
    "model/cactus/lod0": {
      bounds_m: [
        [
          -1.3358440968013192,
          0,
          -0.5382729179279159
        ],
        [
          1.3359389266988844,
          4.580213544863843,
          0.538970207346484
        ]
      ],
      bytes: 99352,
      emissive: [],
      file: "ab32e66d47f221655bbdb2641435603608c50ba65ab9fb2bacad5d6732eb7006.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/cactus/lod0",
        "model/cactus/lod1",
        "model/cactus/lod2"
      ],
      materials: [
        "cactus",
        "cactus_tip"
      ],
      nodes: [
        "cactus"
      ],
      note: "saguaro, 4.6 m: a ribbed trunk (12 soft grooves) with a domed crown, two arms elbowing out to +-x and up, a small arm budding toward -z, filleted joints; materials cactus (green), cactus_tip (light green crowns); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "ab32e66d47f221655bbdb2641435603608c50ba65ab9fb2bacad5d6732eb7006",
      source: {
        procedural: {
          builder: "cactus",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/props.py",
          script_sha256: "0401b56caf40ace7f76cc450c7184193146b42aa9c7b3fc73c94b22159c3bc17"
        }
      },
      stages: [
        "desert-canyons",
        "destination-oasis"
      ],
      tris: 3826,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/cactus/lod1": {
      bounds_m: [
        [
          -1.334961259455655,
          0,
          -0.5363436461300235
        ],
        [
          1.334481108876263,
          4.575020158530308,
          0.5398010748974766
        ]
      ],
      bytes: 31428,
      emissive: [],
      file: "7a9d51343d984e2ed5f7ae79cb8a017a2ceffb74bd7139130a549c3245f67b2a.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/cactus/lod0",
        "model/cactus/lod1",
        "model/cactus/lod2"
      ],
      materials: [
        "cactus",
        "cactus_tip"
      ],
      nodes: [
        "cactus"
      ],
      note: "saguaro, 4.6 m: a ribbed trunk (12 soft grooves) with a domed crown, two arms elbowing out to +-x and up, a small arm budding toward -z, filleted joints; materials cactus (green), cactus_tip (light green crowns); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "7a9d51343d984e2ed5f7ae79cb8a017a2ceffb74bd7139130a549c3245f67b2a",
      source: {
        procedural: {
          builder: "cactus",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/props.py",
          script_sha256: "0401b56caf40ace7f76cc450c7184193146b42aa9c7b3fc73c94b22159c3bc17"
        }
      },
      stages: [
        "desert-canyons",
        "destination-oasis"
      ],
      tris: 1062,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/cactus/lod2": {
      bounds_m: [
        [
          -1.3179441098771578,
          0,
          -0.5290805324920711
        ],
        [
          1.329069055463681,
          4.550721980480672,
          0.5393835275119709
        ]
      ],
      bytes: 10676,
      emissive: [],
      file: "e37fc7bee32ad77f6e6c0b2784517cd1eb806134bbabe2718a6d120e8f2bda93.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/cactus/lod0",
        "model/cactus/lod1",
        "model/cactus/lod2"
      ],
      materials: [
        "cactus",
        "cactus_tip"
      ],
      nodes: [
        "cactus"
      ],
      note: "saguaro, 4.6 m: a ribbed trunk (12 soft grooves) with a domed crown, two arms elbowing out to +-x and up, a small arm budding toward -z, filleted joints; materials cactus (green), cactus_tip (light green crowns); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "e37fc7bee32ad77f6e6c0b2784517cd1eb806134bbabe2718a6d120e8f2bda93",
      source: {
        procedural: {
          builder: "cactus",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/props.py",
          script_sha256: "0401b56caf40ace7f76cc450c7184193146b42aa9c7b3fc73c94b22159c3bc17"
        }
      },
      stages: [
        "desert-canyons",
        "destination-oasis"
      ],
      tris: 270,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/car-boxtruck/lod0": {
      bounds_m: [
        [
          -1.1479866172471893,
          0,
          -3.5073634757709224
        ],
        [
          1.147893233406484,
          3.202893683239618,
          3.4996721032072204
        ]
      ],
      bytes: 1227192,
      emissive: [
        "headlight",
        "taillight"
      ],
      file: "8e81d63ab8ba34bb86dc76864f1381ab33d3799bd885e9a9c452a9c869997432.glb",
      forward: "+Z",
      kind: "model",
      license: "CC0",
      lods: [
        "model/car-boxtruck/lod0",
        "model/car-boxtruck/lod1"
      ],
      materials: [
        "paint",
        "glass",
        "trim",
        "taillight",
        "headlight",
        "rubber",
        "rim"
      ],
      nodes: [
        "body",
        "wheel_FL",
        "wheel_FR",
        "wheel_RL",
        "wheel_RR"
      ],
      note: "Y up, metres, origin on the ground at the centre of the body's footprint, forward +Z (as the hero car), +X is the car's left. Wheel nodes wheel_FL/FR/RL/RR are pivoted at their hubs (spin about local X, steer about Y). Recolour `paint`; drive brake lights with `taillight` emissiveStrength. Materials cut from geometry only (hero pipeline).",
      paint_rgb: [
        0.62,
        0.62,
        0.6
      ],
      sha256: "8e81d63ab8ba34bb86dc76864f1381ab33d3799bd885e9a9c452a9c869997432",
      source: {
        generated: {
          model: "tencent/Hunyuan3D-2",
          model_revision: "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf",
          negative: "text, logo, badge, emblem, lettering, license plate, watermark, people, driver, background scenery, ground shadow, reflection, cropped, cartoon, toy, blurry, multiple vehicles, trailer, open doors",
          params: {
            align: {
              end: "front",
              iou: 0.579105483606952,
              mirror_yaw_deg: 0.5,
              pitch: 15,
              raw_dims: [
                0.852536194706369,
                1.0124185159802437,
                1.994623507259013
              ],
              scale: [
                2.697832671834147,
                3.1607481979936893,
                3.5094342238146554
              ],
              seen_side: "left",
              target: {
                height: 3.2,
                length: 7,
                width: 2.3
              },
              yaw: -75
            },
            body: "mirror-symmetrised (seen half kept), scaled to real size, wheel blobs flattened into dark backdrops, quadric-decimated, materials from soft geometric regions + crisp convex regions (scripts/specs_traffic.py), islands cleaned; then cartoon pass (cartoon/cars/scripts/cartoon.py): bilateral normal filtering + vertex fit and a screened bi-Laplacian low-pass with creases held, circular wheel arches carved at the panel's own radius, borders cut along plane / facing / circle zero sets on each LOD and kept fixed through a border-locked decimation, shading normals from the faired dense surface, baked per-vertex AO in COLOR_0 (0.6..1.0; body, wheels and ground as occluders)",
            hunyuan: {
              box_v: 1.01,
              guidance_scale: 5,
              mc_level: 0,
              num_chunks: 2e4,
              num_inference_steps: 60,
              octree_resolution: 512
            },
            hunyuan_code: "f8db63096c8282cb27354314d896feba5ba6ff8a",
            hunyuan_subfolder: "hunyuan3d-dit-v2-0",
            reference: {
              cutout: "rembg 2.0.62 u2net, hard alpha",
              guidance: 7,
              height: 1024,
              model: "stabilityai/stable-diffusion-xl-base-1.0",
              model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
              scheduler: "EulerDiscreteScheduler",
              seed: 12,
              steps: 40,
              vae: "madebyollin/sdxl-vae-fp16-fix",
              vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd",
              width: 1024
            },
            wheels: "procedural balloon tyre on the five-spoke alloy (cartoon/cars/scripts/cwheel.py)"
          },
          prompt: "three-quarter front view from the left of a white 1980s box truck, flat-nosed cab with two doors and large windscreen, tall square cargo box behind the cab, dual rear wheels, black bumper, full vehicle visible, studio product photo, isolated on pure white background, soft even light",
          seed: 1234,
          steps: 60
        }
      },
      tris: 3e4,
      wheels: [
        {
          hub: [
            0.80784,
            0.48,
            2.42
          ],
          name: "wheel_FL",
          radius: 0.48,
          width: 0.26
        },
        {
          hub: [
            -0.80784,
            0.48,
            2.42
          ],
          name: "wheel_FR",
          radius: 0.48,
          width: 0.26
        },
        {
          hub: [
            0.81001,
            0.48,
            -2
          ],
          name: "wheel_RL",
          radius: 0.48,
          width: 0.26
        },
        {
          hub: [
            -0.81001,
            0.48,
            -2
          ],
          name: "wheel_RR",
          radius: 0.48,
          width: 0.26
        }
      ]
    },
    "model/car-boxtruck/lod1": {
      bounds_m: [
        [
          -1.1473300357368998,
          0,
          -3.5041070214557344
        ],
        [
          1.1473300357369,
          3.2020799227569636,
          3.4977563284037454
        ]
      ],
      bytes: 428976,
      emissive: [
        "headlight",
        "taillight"
      ],
      file: "1f8ad13ab2fe84d140f7454f09fbcfeb3fb77f9fd85f0bb3c798315200ac582f.glb",
      forward: "+Z",
      kind: "model",
      license: "CC0",
      lods: [
        "model/car-boxtruck/lod0",
        "model/car-boxtruck/lod1"
      ],
      materials: [
        "paint",
        "glass",
        "trim",
        "taillight",
        "headlight",
        "rubber",
        "rim"
      ],
      nodes: [
        "body",
        "wheel_FL",
        "wheel_FR",
        "wheel_RL",
        "wheel_RR"
      ],
      note: "Y up, metres, origin on the ground at the centre of the body's footprint, forward +Z (as the hero car), +X is the car's left. Wheel nodes wheel_FL/FR/RL/RR are pivoted at their hubs (spin about local X, steer about Y). Recolour `paint`; drive brake lights with `taillight` emissiveStrength. Materials cut from geometry only (hero pipeline).",
      paint_rgb: [
        0.62,
        0.62,
        0.6
      ],
      sha256: "1f8ad13ab2fe84d140f7454f09fbcfeb3fb77f9fd85f0bb3c798315200ac582f",
      source: {
        generated: {
          model: "tencent/Hunyuan3D-2",
          model_revision: "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf",
          negative: "text, logo, badge, emblem, lettering, license plate, watermark, people, driver, background scenery, ground shadow, reflection, cropped, cartoon, toy, blurry, multiple vehicles, trailer, open doors",
          params: {
            align: {
              end: "front",
              iou: 0.579105483606952,
              mirror_yaw_deg: 0.5,
              pitch: 15,
              raw_dims: [
                0.852536194706369,
                1.0124185159802437,
                1.994623507259013
              ],
              scale: [
                2.697832671834147,
                3.1607481979936893,
                3.5094342238146554
              ],
              seen_side: "left",
              target: {
                height: 3.2,
                length: 7,
                width: 2.3
              },
              yaw: -75
            },
            body: "mirror-symmetrised (seen half kept), scaled to real size, wheel blobs flattened into dark backdrops, quadric-decimated, materials from soft geometric regions + crisp convex regions (scripts/specs_traffic.py), islands cleaned; then cartoon pass (cartoon/cars/scripts/cartoon.py): bilateral normal filtering + vertex fit and a screened bi-Laplacian low-pass with creases held, circular wheel arches carved at the panel's own radius, borders cut along plane / facing / circle zero sets on each LOD and kept fixed through a border-locked decimation, shading normals from the faired dense surface, baked per-vertex AO in COLOR_0 (0.6..1.0; body, wheels and ground as occluders)",
            hunyuan: {
              box_v: 1.01,
              guidance_scale: 5,
              mc_level: 0,
              num_chunks: 2e4,
              num_inference_steps: 60,
              octree_resolution: 512
            },
            hunyuan_code: "f8db63096c8282cb27354314d896feba5ba6ff8a",
            hunyuan_subfolder: "hunyuan3d-dit-v2-0",
            reference: {
              cutout: "rembg 2.0.62 u2net, hard alpha",
              guidance: 7,
              height: 1024,
              model: "stabilityai/stable-diffusion-xl-base-1.0",
              model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
              scheduler: "EulerDiscreteScheduler",
              seed: 12,
              steps: 40,
              vae: "madebyollin/sdxl-vae-fp16-fix",
              vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd",
              width: 1024
            },
            wheels: "procedural balloon tyre on the five-spoke alloy (cartoon/cars/scripts/cwheel.py)"
          },
          prompt: "three-quarter front view from the left of a white 1980s box truck, flat-nosed cab with two doors and large windscreen, tall square cargo box behind the cab, dual rear wheels, black bumper, full vehicle visible, studio product photo, isolated on pure white background, soft even light",
          seed: 1234,
          steps: 60
        }
      },
      tris: 8993,
      wheels: [
        {
          hub: [
            0.80784,
            0.48,
            2.42
          ],
          name: "wheel_FL",
          radius: 0.48,
          width: 0.26
        },
        {
          hub: [
            -0.80784,
            0.48,
            2.42
          ],
          name: "wheel_FR",
          radius: 0.48,
          width: 0.26
        },
        {
          hub: [
            0.81001,
            0.48,
            -2
          ],
          name: "wheel_RL",
          radius: 0.48,
          width: 0.26
        },
        {
          hub: [
            -0.81001,
            0.48,
            -2
          ],
          name: "wheel_RR",
          radius: 0.48,
          width: 0.26
        }
      ]
    },
    "model/car-convertible/lod0": {
      bounds_m: [
        [
          -0.9153149741921255,
          0,
          -2.1544269965513445
        ],
        [
          0.9153149741921255,
          1.2533805617185028,
          2.14864450286962
        ]
      ],
      bytes: 1050160,
      emissive: [
        "headlight",
        "taillight"
      ],
      file: "673af88ebb024de490c2d215dae66c630e86b26ed666ac2ae85c075d28d42a26.glb",
      forward: "+Z",
      kind: "model",
      license: "CC0",
      lods: [
        "model/car-convertible/lod0",
        "model/car-convertible/lod1"
      ],
      materials: [
        "paint",
        "glass",
        "trim",
        "taillight",
        "headlight",
        "rubber",
        "rim"
      ],
      nodes: [
        "body",
        "wheel_FL",
        "wheel_FR",
        "wheel_RL",
        "wheel_RR"
      ],
      note: "Y up, metres, origin on the ground at the centre of the body's footprint, forward +Z (as the hero car), +X is the car's left. Wheel nodes wheel_FL/FR/RL/RR are pivoted at their hubs (spin about local X, steer about Y). Recolour `paint`; drive brake lights with `taillight` emissiveStrength. Materials cut from geometry only (hero pipeline).",
      paint_rgb: [
        0.5,
        0.06,
        0.07
      ],
      sha256: "673af88ebb024de490c2d215dae66c630e86b26ed666ac2ae85c075d28d42a26",
      source: {
        generated: {
          model: "tencent/Hunyuan3D-2",
          model_revision: "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf",
          negative: "text, logo, watermark, license plate, people, driver, background scenery, ground shadow, cropped, cartoon, toy, blurry, multiple cars",
          params: {
            align: {
              end: "front",
              iou: 0.7927023103609477,
              mirror_yaw_deg: 0,
              pitch: -5,
              raw_dims: [
                0.8738172660410672,
                0.5744406397973034,
                1.995067505964175
              ],
              scale: [
                1.9683749301414746,
                2.176029886118562,
                2.155315540524479
              ],
              seen_side: "left",
              target: {
                height: 1.25,
                length: 4.3,
                width: 1.72
              },
              yaw: -35
            },
            body: "mirror-symmetrised (seen half kept), scaled to real size, wheel blobs flattened into dark backdrops, quadric-decimated, materials from soft geometric regions + crisp convex regions (scripts/specs_traffic.py), islands cleaned; then cartoon pass (cartoon/cars/scripts/cartoon.py): bilateral normal filtering + vertex fit and a screened bi-Laplacian low-pass with creases held, circular wheel arches carved at the panel's own radius, borders cut along plane / facing / circle zero sets on each LOD and kept fixed through a border-locked decimation, shading normals from the faired dense surface, baked per-vertex AO in COLOR_0 (0.6..1.0; body, wheels and ground as occluders)",
            hunyuan: {
              box_v: 1.01,
              guidance_scale: 5,
              mc_level: 0,
              num_chunks: 2e4,
              num_inference_steps: 60,
              octree_resolution: 512
            },
            hunyuan_code: "f8db63096c8282cb27354314d896feba5ba6ff8a",
            length_m: 4.25,
            reference: {
              candidates: [
                1,
                2,
                3,
                4,
                5,
                6
              ],
              cutout: "rembg",
              guidance: 7,
              height: 1024,
              model: "stabilityai/stable-diffusion-xl-base-1.0",
              model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
              negative: "text, logo, watermark, license plate, people, driver, background scenery, ground shadow, cropped, cartoon, toy, blurry, multiple cars",
              prompt: "a 1986 red two-door convertible sports car with the roof down, wedge shape, pop-up headlights, black tyres, full car visible, three-quarter front view from the left, studio product photo, isolated on pure white background, soft even light, no shadow",
              scheduler: "EulerDiscreteScheduler",
              seed: 1,
              steps: 40,
              vae: "madebyollin/sdxl-vae-fp16-fix",
              vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd",
              width: 1024
            },
            wheels: "procedural balloon tyre on the five-spoke alloy (cartoon/cars/scripts/cwheel.py)"
          },
          prompt: "a 1986 red two-door convertible sports car with the roof down, wedge shape, pop-up headlights, black tyres, full car visible, three-quarter front view from the left, studio product photo, isolated on pure white background, soft even light, no shadow",
          seed: 1234,
          steps: 60
        }
      },
      tris: 3e4,
      wheels: [
        {
          hub: [
            0.71219,
            0.3,
            1.18147
          ],
          name: "wheel_FL",
          radius: 0.3,
          width: 0.21
        },
        {
          hub: [
            -0.71219,
            0.3,
            1.18147
          ],
          name: "wheel_FR",
          radius: 0.3,
          width: 0.21
        },
        {
          hub: [
            0.72289,
            0.3,
            -1.13069
          ],
          name: "wheel_RL",
          radius: 0.3,
          width: 0.21
        },
        {
          hub: [
            -0.72289,
            0.3,
            -1.13069
          ],
          name: "wheel_RR",
          radius: 0.3,
          width: 0.21
        }
      ]
    },
    "model/car-convertible/lod1": {
      bounds_m: [
        [
          -0.9108905037672155,
          0,
          -2.149233238829621
        ],
        [
          0.8937952267825132,
          1.2541418279238365,
          2.1491097763894382
        ]
      ],
      bytes: 411048,
      emissive: [
        "headlight",
        "taillight"
      ],
      file: "fb10f26448aa90ec300c9991b0db3d4d76ebd1f11f89167df0e68717f25b12e2.glb",
      forward: "+Z",
      kind: "model",
      license: "CC0",
      lods: [
        "model/car-convertible/lod0",
        "model/car-convertible/lod1"
      ],
      materials: [
        "paint",
        "glass",
        "trim",
        "taillight",
        "headlight",
        "rubber",
        "rim"
      ],
      nodes: [
        "body",
        "wheel_FL",
        "wheel_FR",
        "wheel_RL",
        "wheel_RR"
      ],
      note: "Y up, metres, origin on the ground at the centre of the body's footprint, forward +Z (as the hero car), +X is the car's left. Wheel nodes wheel_FL/FR/RL/RR are pivoted at their hubs (spin about local X, steer about Y). Recolour `paint`; drive brake lights with `taillight` emissiveStrength. Materials cut from geometry only (hero pipeline).",
      paint_rgb: [
        0.5,
        0.06,
        0.07
      ],
      sha256: "fb10f26448aa90ec300c9991b0db3d4d76ebd1f11f89167df0e68717f25b12e2",
      source: {
        generated: {
          model: "tencent/Hunyuan3D-2",
          model_revision: "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf",
          negative: "text, logo, watermark, license plate, people, driver, background scenery, ground shadow, cropped, cartoon, toy, blurry, multiple cars",
          params: {
            align: {
              end: "front",
              iou: 0.7927023103609477,
              mirror_yaw_deg: 0,
              pitch: -5,
              raw_dims: [
                0.8738172660410672,
                0.5744406397973034,
                1.995067505964175
              ],
              scale: [
                1.9683749301414746,
                2.176029886118562,
                2.155315540524479
              ],
              seen_side: "left",
              target: {
                height: 1.25,
                length: 4.3,
                width: 1.72
              },
              yaw: -35
            },
            body: "mirror-symmetrised (seen half kept), scaled to real size, wheel blobs flattened into dark backdrops, quadric-decimated, materials from soft geometric regions + crisp convex regions (scripts/specs_traffic.py), islands cleaned; then cartoon pass (cartoon/cars/scripts/cartoon.py): bilateral normal filtering + vertex fit and a screened bi-Laplacian low-pass with creases held, circular wheel arches carved at the panel's own radius, borders cut along plane / facing / circle zero sets on each LOD and kept fixed through a border-locked decimation, shading normals from the faired dense surface, baked per-vertex AO in COLOR_0 (0.6..1.0; body, wheels and ground as occluders)",
            hunyuan: {
              box_v: 1.01,
              guidance_scale: 5,
              mc_level: 0,
              num_chunks: 2e4,
              num_inference_steps: 60,
              octree_resolution: 512
            },
            hunyuan_code: "f8db63096c8282cb27354314d896feba5ba6ff8a",
            length_m: 4.25,
            reference: {
              candidates: [
                1,
                2,
                3,
                4,
                5,
                6
              ],
              cutout: "rembg",
              guidance: 7,
              height: 1024,
              model: "stabilityai/stable-diffusion-xl-base-1.0",
              model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
              negative: "text, logo, watermark, license plate, people, driver, background scenery, ground shadow, cropped, cartoon, toy, blurry, multiple cars",
              prompt: "a 1986 red two-door convertible sports car with the roof down, wedge shape, pop-up headlights, black tyres, full car visible, three-quarter front view from the left, studio product photo, isolated on pure white background, soft even light, no shadow",
              scheduler: "EulerDiscreteScheduler",
              seed: 1,
              steps: 40,
              vae: "madebyollin/sdxl-vae-fp16-fix",
              vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd",
              width: 1024
            },
            wheels: "procedural balloon tyre on the five-spoke alloy (cartoon/cars/scripts/cwheel.py)"
          },
          prompt: "a 1986 red two-door convertible sports car with the roof down, wedge shape, pop-up headlights, black tyres, full car visible, three-quarter front view from the left, studio product photo, isolated on pure white background, soft even light, no shadow",
          seed: 1234,
          steps: 60
        }
      },
      tris: 9e3,
      wheels: [
        {
          hub: [
            0.71219,
            0.3,
            1.18147
          ],
          name: "wheel_FL",
          radius: 0.3,
          width: 0.21
        },
        {
          hub: [
            -0.71219,
            0.3,
            1.18147
          ],
          name: "wheel_FR",
          radius: 0.3,
          width: 0.21
        },
        {
          hub: [
            0.72289,
            0.3,
            -1.13069
          ],
          name: "wheel_RL",
          radius: 0.3,
          width: 0.21
        },
        {
          hub: [
            -0.72289,
            0.3,
            -1.13069
          ],
          name: "wheel_RR",
          radius: 0.3,
          width: 0.21
        }
      ]
    },
    "model/car-hero/lod0": {
      bounds_m: [
        [
          -1.0109027377709505,
          0,
          -2.1700419199478214
        ],
        [
          1.010902737770953,
          1.1451165230630698,
          2.2313371664356483
        ]
      ],
      bytes: 2505456,
      file: "5583cd1b86a4cec997f18b010c357b565262a5eaa8fd3141cf23f31368510573.glb",
      forward: "+Z",
      kind: "model",
      license: "CC0",
      lods: [
        "model/car-hero/lod0",
        "model/car-hero/lod1"
      ],
      materials: [
        "paint",
        "glass",
        "interior",
        "trim",
        "chrome",
        "taillight",
        "headlight",
        "indicator",
        "rubber",
        "rim",
        "plate"
      ],
      note: "Y up, metres, origin on the ground midway between the axles; +X is the car's left (wheel_FL/RL at +X). Each wheel node is pivoted at its hub (spin about local X, steer about Y). Recolour `paint` albedo per character; drive brake lights with `taillight` emissiveStrength. Babylon's glTF loader (left-handed scene) puts +Z forward at Babylon -Z.",
      sha256: "5583cd1b86a4cec997f18b010c357b565262a5eaa8fd3141cf23f31368510573",
      source: {
        generated: {
          model: "tencent/Hunyuan3D-2",
          model_revision: "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf",
          negative: "text, logo, badge, emblem, lettering, license plate, watermark, people, driver, background scenery, ground shadow, reflection, cropped, cartoon, toy, blurry, multiple cars, hardtop, roof, soft top, roll bar",
          params: {
            align: {
              end: "rear",
              iou: 0.761794876922154,
              mirror_yaw_deg: 0,
              pitch: -5,
              raw_dims: [
                0.8590947399035411,
                0.6005130070624833,
                1.9940448694445094
              ],
              scale: [
                2.2698311483305615,
                1.9150292940787916,
                2.206570206830767
              ],
              seen_side: "left",
              yaw: -30
            },
            body: "mirror-symmetrised (seen half kept), scaled to 4.40 x 1.95 x 1.15 m, wheel blobs flattened into dark backdrops, badge and cowl ridge refilled biharmonically, quadric-decimated, materials by geometric regions; then cartoon pass (cartoon/cars/scripts/cartoon.py): bilateral normal filtering + vertex fit and a screened bi-Laplacian low-pass with creases held, circular wheel arches carved at the panel's own radius, borders cut along plane / facing / circle zero sets on each LOD and kept fixed through a border-locked decimation, shading normals from the faired dense surface, baked per-vertex AO in COLOR_0 (0.6..1.0; body, wheels and ground as occluders)",
            face_labels: {
              glass: 1972,
              indicator: 457,
              interior: 9238,
              paint: 13183,
              plate: 95,
              taillight: 497,
              trim: 17974
            },
            hunyuan: {
              box_v: 1.01,
              guidance_scale: 5,
              mc_level: 0,
              num_chunks: 2e4,
              num_inference_steps: 60,
              octree_resolution: 512
            },
            hunyuan_code: "f8db63096c8282cb27354314d896feba5ba6ff8a",
            hunyuan_subfolder: "hunyuan3d-dit-v2-0",
            lod_body_tris: 44976,
            lod_wheel_tris: 15024,
            reference: {
              cutout: "rembg 2.0.62 u2net, hard alpha",
              guidance: 7,
              height: 1024,
              model: "stabilityai/stable-diffusion-xl-base-1.0",
              model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
              scheduler: "EulerDiscreteScheduler",
              seed: 2,
              steps: 40,
              vae: "madebyollin/sdxl-vae-fp16-fix",
              vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd",
              width: 1024
            },
            wheels: "procedural balloon tyre on the five-spoke alloy (cartoon/cars/scripts/cwheel.py)"
          },
          prompt: "three-quarter rear view from the left of a red 1980s Italian convertible sports car, roof down, open cockpit, two black leather seats, low wedge body, wide rear, red tail lights, black rear panel, twin exhausts, five-spoke silver alloy wheels, studio product photo, isolated on pure white background, soft even light",
          seed: 1234,
          steps: 60
        }
      },
      tris: 66940,
      wheels: [
        {
          hub: [
            0.83496,
            0.315,
            1.19847
          ],
          name: "wheel_FL",
          radius: 0.315,
          width: 0.225
        },
        {
          hub: [
            -0.83496,
            0.315,
            1.19847
          ],
          name: "wheel_FR",
          radius: 0.315,
          width: 0.225
        },
        {
          hub: [
            0.82207,
            0.33,
            -1.19847
          ],
          name: "wheel_RL",
          radius: 0.33,
          width: 0.255
        },
        {
          hub: [
            -0.82207,
            0.33,
            -1.19847
          ],
          name: "wheel_RR",
          radius: 0.33,
          width: 0.255
        }
      ]
    },
    "model/car-hero/lod1": {
      bounds_m: [
        [
          -1.0066069654543157,
          0,
          -2.170307020825298
        ],
        [
          0.9886167257277161,
          1.1400233634528225,
          2.231729301204702
        ]
      ],
      bytes: 707212,
      file: "8fcac921c4dbafbc379cc0e4686451d2b0c573c7a3616508201234a3a9d306a2.glb",
      forward: "+Z",
      kind: "model",
      license: "CC0",
      lods: [
        "model/car-hero/lod0",
        "model/car-hero/lod1"
      ],
      materials: [
        "paint",
        "glass",
        "interior",
        "trim",
        "chrome",
        "taillight",
        "headlight",
        "indicator",
        "rubber",
        "rim",
        "plate"
      ],
      note: "Y up, metres, origin on the ground midway between the axles; +X is the car's left (wheel_FL/RL at +X). Each wheel node is pivoted at its hub (spin about local X, steer about Y). Recolour `paint` albedo per character; drive brake lights with `taillight` emissiveStrength. Babylon's glTF loader (left-handed scene) puts +Z forward at Babylon -Z.",
      sha256: "8fcac921c4dbafbc379cc0e4686451d2b0c573c7a3616508201234a3a9d306a2",
      source: {
        generated: {
          model: "tencent/Hunyuan3D-2",
          model_revision: "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf",
          negative: "text, logo, badge, emblem, lettering, license plate, watermark, people, driver, background scenery, ground shadow, reflection, cropped, cartoon, toy, blurry, multiple cars, hardtop, roof, soft top, roll bar",
          params: {
            align: {
              end: "rear",
              iou: 0.761794876922154,
              mirror_yaw_deg: 0,
              pitch: -5,
              raw_dims: [
                0.8590947399035411,
                0.6005130070624833,
                1.9940448694445094
              ],
              scale: [
                2.2698311483305615,
                1.9150292940787916,
                2.206570206830767
              ],
              seen_side: "left",
              yaw: -30
            },
            body: "mirror-symmetrised (seen half kept), scaled to 4.40 x 1.95 x 1.15 m, wheel blobs flattened into dark backdrops, badge and cowl ridge refilled biharmonically, quadric-decimated, materials by geometric regions; then cartoon pass (cartoon/cars/scripts/cartoon.py): bilateral normal filtering + vertex fit and a screened bi-Laplacian low-pass with creases held, circular wheel arches carved at the panel's own radius, borders cut along plane / facing / circle zero sets on each LOD and kept fixed through a border-locked decimation, shading normals from the faired dense surface, baked per-vertex AO in COLOR_0 (0.6..1.0; body, wheels and ground as occluders)",
            face_labels: {
              glass: 447,
              indicator: 217,
              interior: 1478,
              paint: 3619,
              plate: 44,
              taillight: 358,
              trim: 4629
            },
            hunyuan: {
              box_v: 1.01,
              guidance_scale: 5,
              mc_level: 0,
              num_chunks: 2e4,
              num_inference_steps: 60,
              octree_resolution: 512
            },
            hunyuan_code: "f8db63096c8282cb27354314d896feba5ba6ff8a",
            hunyuan_subfolder: "hunyuan3d-dit-v2-0",
            lod_body_tris: 11392,
            lod_wheel_tris: 3608,
            reference: {
              cutout: "rembg 2.0.62 u2net, hard alpha",
              guidance: 7,
              height: 1024,
              model: "stabilityai/stable-diffusion-xl-base-1.0",
              model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
              scheduler: "EulerDiscreteScheduler",
              seed: 2,
              steps: 40,
              vae: "madebyollin/sdxl-vae-fp16-fix",
              vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd",
              width: 1024
            },
            wheels: "procedural balloon tyre on the five-spoke alloy (cartoon/cars/scripts/cwheel.py)"
          },
          prompt: "three-quarter rear view from the left of a red 1980s Italian convertible sports car, roof down, open cockpit, two black leather seats, low wedge body, wide rear, red tail lights, black rear panel, twin exhausts, five-spoke silver alloy wheels, studio product photo, isolated on pure white background, soft even light",
          seed: 1234,
          steps: 60
        }
      },
      tris: 15e3,
      wheels: [
        {
          hub: [
            0.83496,
            0.315,
            1.19847
          ],
          name: "wheel_FL",
          radius: 0.315,
          width: 0.225
        },
        {
          hub: [
            -0.83496,
            0.315,
            1.19847
          ],
          name: "wheel_FR",
          radius: 0.315,
          width: 0.225
        },
        {
          hub: [
            0.82207,
            0.33,
            -1.19847
          ],
          name: "wheel_RL",
          radius: 0.33,
          width: 0.255
        },
        {
          hub: [
            -0.82207,
            0.33,
            -1.19847
          ],
          name: "wheel_RR",
          radius: 0.33,
          width: 0.255
        }
      ]
    },
    "model/car-pickup/lod0": {
      bounds_m: [
        [
          -0.9663238628508415,
          0,
          -2.2723093751663717
        ],
        [
          0.9663238628508415,
          1.7003430825120407,
          2.275374767811315
        ]
      ],
      bytes: 1072544,
      emissive: [
        "headlight",
        "taillight"
      ],
      file: "58819e324b86aba513cdea7938b67898dffe297fdf892a32f5f6cc1d97445a6b.glb",
      forward: "+Z",
      kind: "model",
      license: "CC0",
      lods: [
        "model/car-pickup/lod0",
        "model/car-pickup/lod1"
      ],
      materials: [
        "paint",
        "glass",
        "trim",
        "taillight",
        "headlight",
        "rubber",
        "rim"
      ],
      nodes: [
        "body",
        "wheel_FL",
        "wheel_FR",
        "wheel_RL",
        "wheel_RR"
      ],
      note: "Y up, metres, origin on the ground at the centre of the body's footprint, forward +Z (as the hero car), +X is the car's left. Wheel nodes wheel_FL/FR/RL/RR are pivoted at their hubs (spin about local X, steer about Y). Recolour `paint`; drive brake lights with `taillight` emissiveStrength. Materials cut from geometry only (hero pipeline).",
      paint_rgb: [
        0.12,
        0.09,
        0.09
      ],
      sha256: "58819e324b86aba513cdea7938b67898dffe297fdf892a32f5f6cc1d97445a6b",
      source: {
        generated: {
          model: "tencent/Hunyuan3D-2",
          model_revision: "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf",
          negative: "text, logo, watermark, license plate, people, driver, background scenery, ground shadow, cropped, cartoon, toy, blurry, multiple vehicles",
          params: {
            align: {
              end: "front",
              iou: 0.752199819352583,
              mirror_yaw_deg: 0,
              pitch: -10,
              raw_dims: [
                0.7756855820620545,
                0.8187385499477386,
                1.9939046042357131
              ],
              scale: [
                2.2173932837936916,
                2.076364915403719,
                2.281954708532341
              ],
              seen_side: "left",
              target: {
                height: 1.7,
                length: 4.55,
                width: 1.72
              },
              yaw: 30
            },
            body: "mirror-symmetrised (seen half kept), scaled to real size, wheel blobs flattened into dark backdrops, quadric-decimated, materials from soft geometric regions + crisp convex regions (scripts/specs_traffic.py), islands cleaned; then cartoon pass (cartoon/cars/scripts/cartoon.py): bilateral normal filtering + vertex fit and a screened bi-Laplacian low-pass with creases held, circular wheel arches carved at the panel's own radius, borders cut along plane / facing / circle zero sets on each LOD and kept fixed through a border-locked decimation, shading normals from the faired dense surface, baked per-vertex AO in COLOR_0 (0.6..1.0; body, wheels and ground as occluders)",
            hunyuan: {
              box_v: 1.01,
              guidance_scale: 5,
              mc_level: 0,
              num_chunks: 2e4,
              num_inference_steps: 60,
              octree_resolution: 512
            },
            hunyuan_code: "f8db63096c8282cb27354314d896feba5ba6ff8a",
            length_m: 4.55,
            reference: {
              candidates: [
                1,
                2,
                3,
                4,
                5,
                6
              ],
              cutout: "rembg",
              guidance: 7,
              height: 1024,
              model: "stabilityai/stable-diffusion-xl-base-1.0",
              model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
              negative: "text, logo, watermark, license plate, people, driver, background scenery, ground shadow, cropped, cartoon, toy, blurry, multiple vehicles",
              prompt: "a 1984 compact pickup truck, two-door cab with open cargo bed, plain solid paint, chrome bumper, black tyres, full truck visible, three-quarter front view from the left, studio product photo, isolated on pure white background, soft even light, no shadow",
              scheduler: "EulerDiscreteScheduler",
              seed: 3,
              steps: 40,
              vae: "madebyollin/sdxl-vae-fp16-fix",
              vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd",
              width: 1024
            },
            wheels: "procedural balloon tyre on the five-spoke alloy (cartoon/cars/scripts/cwheel.py)"
          },
          prompt: "a 1984 compact pickup truck, two-door cab with open cargo bed, plain solid paint, chrome bumper, black tyres, full truck visible, three-quarter front view from the left, studio product photo, isolated on pure white background, soft even light, no shadow",
          seed: 1234,
          steps: 60
        }
      },
      tris: 3e4,
      wheels: [
        {
          hub: [
            0.68684,
            0.36,
            1.55493
          ],
          name: "wheel_FL",
          radius: 0.36,
          width: 0.22
        },
        {
          hub: [
            -0.68684,
            0.36,
            1.55493
          ],
          name: "wheel_FR",
          radius: 0.36,
          width: 0.22
        },
        {
          hub: [
            0.68234,
            0.36,
            -1.08472
          ],
          name: "wheel_RL",
          radius: 0.36,
          width: 0.22
        },
        {
          hub: [
            -0.68234,
            0.36,
            -1.08472
          ],
          name: "wheel_RR",
          radius: 0.36,
          width: 0.22
        }
      ]
    },
    "model/car-pickup/lod1": {
      bounds_m: [
        [
          -0.9574108726004698,
          0,
          -2.2710694661281754
        ],
        [
          0.9633743218964316,
          1.7001552711059809,
          2.2778903055610424
        ]
      ],
      bytes: 400272,
      emissive: [
        "headlight",
        "taillight"
      ],
      file: "3e7acf97631134c797897127973fc94b5ddf4fe99433f6dd48ae8bd29c45e5ff.glb",
      forward: "+Z",
      kind: "model",
      license: "CC0",
      lods: [
        "model/car-pickup/lod0",
        "model/car-pickup/lod1"
      ],
      materials: [
        "paint",
        "glass",
        "trim",
        "taillight",
        "headlight",
        "rubber",
        "rim"
      ],
      nodes: [
        "body",
        "wheel_FL",
        "wheel_FR",
        "wheel_RL",
        "wheel_RR"
      ],
      note: "Y up, metres, origin on the ground at the centre of the body's footprint, forward +Z (as the hero car), +X is the car's left. Wheel nodes wheel_FL/FR/RL/RR are pivoted at their hubs (spin about local X, steer about Y). Recolour `paint`; drive brake lights with `taillight` emissiveStrength. Materials cut from geometry only (hero pipeline).",
      paint_rgb: [
        0.12,
        0.09,
        0.09
      ],
      sha256: "3e7acf97631134c797897127973fc94b5ddf4fe99433f6dd48ae8bd29c45e5ff",
      source: {
        generated: {
          model: "tencent/Hunyuan3D-2",
          model_revision: "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf",
          negative: "text, logo, watermark, license plate, people, driver, background scenery, ground shadow, cropped, cartoon, toy, blurry, multiple vehicles",
          params: {
            align: {
              end: "front",
              iou: 0.752199819352583,
              mirror_yaw_deg: 0,
              pitch: -10,
              raw_dims: [
                0.7756855820620545,
                0.8187385499477386,
                1.9939046042357131
              ],
              scale: [
                2.2173932837936916,
                2.076364915403719,
                2.281954708532341
              ],
              seen_side: "left",
              target: {
                height: 1.7,
                length: 4.55,
                width: 1.72
              },
              yaw: 30
            },
            body: "mirror-symmetrised (seen half kept), scaled to real size, wheel blobs flattened into dark backdrops, quadric-decimated, materials from soft geometric regions + crisp convex regions (scripts/specs_traffic.py), islands cleaned; then cartoon pass (cartoon/cars/scripts/cartoon.py): bilateral normal filtering + vertex fit and a screened bi-Laplacian low-pass with creases held, circular wheel arches carved at the panel's own radius, borders cut along plane / facing / circle zero sets on each LOD and kept fixed through a border-locked decimation, shading normals from the faired dense surface, baked per-vertex AO in COLOR_0 (0.6..1.0; body, wheels and ground as occluders)",
            hunyuan: {
              box_v: 1.01,
              guidance_scale: 5,
              mc_level: 0,
              num_chunks: 2e4,
              num_inference_steps: 60,
              octree_resolution: 512
            },
            hunyuan_code: "f8db63096c8282cb27354314d896feba5ba6ff8a",
            length_m: 4.55,
            reference: {
              candidates: [
                1,
                2,
                3,
                4,
                5,
                6
              ],
              cutout: "rembg",
              guidance: 7,
              height: 1024,
              model: "stabilityai/stable-diffusion-xl-base-1.0",
              model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
              negative: "text, logo, watermark, license plate, people, driver, background scenery, ground shadow, cropped, cartoon, toy, blurry, multiple vehicles",
              prompt: "a 1984 compact pickup truck, two-door cab with open cargo bed, plain solid paint, chrome bumper, black tyres, full truck visible, three-quarter front view from the left, studio product photo, isolated on pure white background, soft even light, no shadow",
              scheduler: "EulerDiscreteScheduler",
              seed: 3,
              steps: 40,
              vae: "madebyollin/sdxl-vae-fp16-fix",
              vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd",
              width: 1024
            },
            wheels: "procedural balloon tyre on the five-spoke alloy (cartoon/cars/scripts/cwheel.py)"
          },
          prompt: "a 1984 compact pickup truck, two-door cab with open cargo bed, plain solid paint, chrome bumper, black tyres, full truck visible, three-quarter front view from the left, studio product photo, isolated on pure white background, soft even light, no shadow",
          seed: 1234,
          steps: 60
        }
      },
      tris: 9e3,
      wheels: [
        {
          hub: [
            0.68684,
            0.36,
            1.55493
          ],
          name: "wheel_FL",
          radius: 0.36,
          width: 0.22
        },
        {
          hub: [
            -0.68684,
            0.36,
            1.55493
          ],
          name: "wheel_FR",
          radius: 0.36,
          width: 0.22
        },
        {
          hub: [
            0.68234,
            0.36,
            -1.08472
          ],
          name: "wheel_RL",
          radius: 0.36,
          width: 0.22
        },
        {
          hub: [
            -0.68234,
            0.36,
            -1.08472
          ],
          name: "wheel_RR",
          radius: 0.36,
          width: 0.22
        }
      ]
    },
    "model/car-sedan/lod0": {
      bounds_m: [
        [
          -0.9403361173783942,
          0,
          -2.3335479394446548
        ],
        [
          0.9405099167331593,
          1.4000636064530436,
          2.3261890854697804
        ]
      ],
      bytes: 1022320,
      emissive: [
        "headlight",
        "taillight"
      ],
      file: "aa59dc519f2cca32b801847033800f1c4f1adc253d6540d959b2a21370aa6780.glb",
      forward: "+Z",
      kind: "model",
      license: "CC0",
      lods: [
        "model/car-sedan/lod0",
        "model/car-sedan/lod1"
      ],
      materials: [
        "paint",
        "glass",
        "trim",
        "taillight",
        "headlight",
        "rubber",
        "rim"
      ],
      nodes: [
        "body",
        "wheel_FL",
        "wheel_FR",
        "wheel_RL",
        "wheel_RR"
      ],
      note: "Y up, metres, origin on the ground at the centre of the body's footprint, forward +Z (as the hero car), +X is the car's left. Wheel nodes wheel_FL/FR/RL/RR are pivoted at their hubs (spin about local X, steer about Y). Recolour `paint`; drive brake lights with `taillight` emissiveStrength. Materials cut from geometry only (hero pipeline).",
      paint_rgb: [
        0.55,
        0.53,
        0.5
      ],
      sha256: "aa59dc519f2cca32b801847033800f1c4f1adc253d6540d959b2a21370aa6780",
      source: {
        generated: {
          model: "tencent/Hunyuan3D-2",
          model_revision: "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf",
          negative: "text, logo, watermark, license plate, people, driver, background scenery, ground shadow, cropped, cartoon, toy, blurry, multiple cars",
          params: {
            align: {
              end: "front",
              iou: 0.7642637543750028,
              mirror_yaw_deg: 0,
              pitch: 0,
              raw_dims: [
                0.7890694406651344,
                0.6644642846658826,
                1.9939558506145398
              ],
              scale: [
                2.2178022741887755,
                2.1069604978151264,
                2.332047622100993
              ],
              seen_side: "left",
              target: {
                height: 1.4,
                length: 4.65,
                width: 1.75
              },
              yaw: -35
            },
            body: "mirror-symmetrised (seen half kept), scaled to real size, wheel blobs flattened into dark backdrops, quadric-decimated, materials from soft geometric regions + crisp convex regions (scripts/specs_traffic.py), islands cleaned; then cartoon pass (cartoon/cars/scripts/cartoon.py): bilateral normal filtering + vertex fit and a screened bi-Laplacian low-pass with creases held, circular wheel arches carved at the panel's own radius, borders cut along plane / facing / circle zero sets on each LOD and kept fixed through a border-locked decimation, shading normals from the faired dense surface, baked per-vertex AO in COLOR_0 (0.6..1.0; body, wheels and ground as occluders)",
            hunyuan: {
              box_v: 1.01,
              guidance_scale: 5,
              mc_level: 0,
              num_chunks: 2e4,
              num_inference_steps: 60,
              octree_resolution: 512
            },
            hunyuan_code: "f8db63096c8282cb27354314d896feba5ba6ff8a",
            length_m: 4.65,
            reference: {
              candidates: [
                1,
                2,
                3,
                4,
                5,
                6
              ],
              cutout: "rembg",
              guidance: 7,
              height: 1024,
              model: "stabilityai/stable-diffusion-xl-base-1.0",
              model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
              negative: "text, logo, watermark, license plate, people, driver, background scenery, ground shadow, cropped, cartoon, toy, blurry, multiple cars",
              prompt: "a 1985 boxy four-door family sedan car, plain solid paint, chrome bumpers, rectangular headlights, black tyres, full car visible, three-quarter front view from the left, studio product photo, isolated on pure white background, soft even light, no shadow",
              scheduler: "EulerDiscreteScheduler",
              seed: 4,
              steps: 40,
              vae: "madebyollin/sdxl-vae-fp16-fix",
              vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd",
              width: 1024
            },
            wheels: "procedural balloon tyre on the five-spoke alloy (cartoon/cars/scripts/cwheel.py)"
          },
          prompt: "a 1985 boxy four-door family sedan car, plain solid paint, chrome bumpers, rectangular headlights, black tyres, full car visible, three-quarter front view from the left, studio product photo, isolated on pure white background, soft even light, no shadow",
          seed: 1234,
          steps: 60
        }
      },
      tris: 3e4,
      wheels: [
        {
          hub: [
            0.70729,
            0.31,
            1.48107
          ],
          name: "wheel_FL",
          radius: 0.31,
          width: 0.2
        },
        {
          hub: [
            -0.70729,
            0.31,
            1.48107
          ],
          name: "wheel_FR",
          radius: 0.31,
          width: 0.2
        },
        {
          hub: [
            0.72738,
            0.31,
            -1.05314
          ],
          name: "wheel_RL",
          radius: 0.31,
          width: 0.2
        },
        {
          hub: [
            -0.72738,
            0.31,
            -1.05314
          ],
          name: "wheel_RR",
          radius: 0.31,
          width: 0.2
        }
      ]
    },
    "model/car-sedan/lod1": {
      bounds_m: [
        [
          -0.943084991944776,
          0,
          -2.322884679241221
        ],
        [
          0.9420210540905979,
          1.3995757436625516,
          2.3245595252428193
        ]
      ],
      bytes: 394992,
      emissive: [
        "headlight",
        "taillight"
      ],
      file: "3ea572638d9ab9c8e5961b822677a258a99464f4ff149d361b009fb462c77688.glb",
      forward: "+Z",
      kind: "model",
      license: "CC0",
      lods: [
        "model/car-sedan/lod0",
        "model/car-sedan/lod1"
      ],
      materials: [
        "paint",
        "glass",
        "trim",
        "taillight",
        "headlight",
        "rubber",
        "rim"
      ],
      nodes: [
        "body",
        "wheel_FL",
        "wheel_FR",
        "wheel_RL",
        "wheel_RR"
      ],
      note: "Y up, metres, origin on the ground at the centre of the body's footprint, forward +Z (as the hero car), +X is the car's left. Wheel nodes wheel_FL/FR/RL/RR are pivoted at their hubs (spin about local X, steer about Y). Recolour `paint`; drive brake lights with `taillight` emissiveStrength. Materials cut from geometry only (hero pipeline).",
      paint_rgb: [
        0.55,
        0.53,
        0.5
      ],
      sha256: "3ea572638d9ab9c8e5961b822677a258a99464f4ff149d361b009fb462c77688",
      source: {
        generated: {
          model: "tencent/Hunyuan3D-2",
          model_revision: "9cd649ba6913f7a852e3286bad86bfa9a2d83dcf",
          negative: "text, logo, watermark, license plate, people, driver, background scenery, ground shadow, cropped, cartoon, toy, blurry, multiple cars",
          params: {
            align: {
              end: "front",
              iou: 0.7642637543750028,
              mirror_yaw_deg: 0,
              pitch: 0,
              raw_dims: [
                0.7890694406651344,
                0.6644642846658826,
                1.9939558506145398
              ],
              scale: [
                2.2178022741887755,
                2.1069604978151264,
                2.332047622100993
              ],
              seen_side: "left",
              target: {
                height: 1.4,
                length: 4.65,
                width: 1.75
              },
              yaw: -35
            },
            body: "mirror-symmetrised (seen half kept), scaled to real size, wheel blobs flattened into dark backdrops, quadric-decimated, materials from soft geometric regions + crisp convex regions (scripts/specs_traffic.py), islands cleaned; then cartoon pass (cartoon/cars/scripts/cartoon.py): bilateral normal filtering + vertex fit and a screened bi-Laplacian low-pass with creases held, circular wheel arches carved at the panel's own radius, borders cut along plane / facing / circle zero sets on each LOD and kept fixed through a border-locked decimation, shading normals from the faired dense surface, baked per-vertex AO in COLOR_0 (0.6..1.0; body, wheels and ground as occluders)",
            hunyuan: {
              box_v: 1.01,
              guidance_scale: 5,
              mc_level: 0,
              num_chunks: 2e4,
              num_inference_steps: 60,
              octree_resolution: 512
            },
            hunyuan_code: "f8db63096c8282cb27354314d896feba5ba6ff8a",
            length_m: 4.65,
            reference: {
              candidates: [
                1,
                2,
                3,
                4,
                5,
                6
              ],
              cutout: "rembg",
              guidance: 7,
              height: 1024,
              model: "stabilityai/stable-diffusion-xl-base-1.0",
              model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
              negative: "text, logo, watermark, license plate, people, driver, background scenery, ground shadow, cropped, cartoon, toy, blurry, multiple cars",
              prompt: "a 1985 boxy four-door family sedan car, plain solid paint, chrome bumpers, rectangular headlights, black tyres, full car visible, three-quarter front view from the left, studio product photo, isolated on pure white background, soft even light, no shadow",
              scheduler: "EulerDiscreteScheduler",
              seed: 4,
              steps: 40,
              vae: "madebyollin/sdxl-vae-fp16-fix",
              vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd",
              width: 1024
            },
            wheels: "procedural balloon tyre on the five-spoke alloy (cartoon/cars/scripts/cwheel.py)"
          },
          prompt: "a 1985 boxy four-door family sedan car, plain solid paint, chrome bumpers, rectangular headlights, black tyres, full car visible, three-quarter front view from the left, studio product photo, isolated on pure white background, soft even light, no shadow",
          seed: 1234,
          steps: 60
        }
      },
      tris: 9e3,
      wheels: [
        {
          hub: [
            0.70729,
            0.31,
            1.48107
          ],
          name: "wheel_FL",
          radius: 0.31,
          width: 0.2
        },
        {
          hub: [
            -0.70729,
            0.31,
            1.48107
          ],
          name: "wheel_FR",
          radius: 0.31,
          width: 0.2
        },
        {
          hub: [
            0.72738,
            0.31,
            -1.05314
          ],
          name: "wheel_RL",
          radius: 0.31,
          width: 0.2
        },
        {
          hub: [
            -0.72738,
            0.31,
            -1.05314
          ],
          name: "wheel_RR",
          radius: 0.31,
          width: 0.2
        }
      ]
    },
    "model/castle-tower/lod0": {
      bounds_m: [
        [
          -5.25,
          0,
          -5.25
        ],
        [
          5.25,
          19.799999999999997,
          5.295
        ]
      ],
      bytes: 114720,
      emissive: [],
      file: "efd3b848b6b59d724635b77f06d82751bf6cb62333c55e1b4ffcf88e349c7954.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/castle-tower/lod0",
        "model/castle-tower/lod1",
        "model/castle-tower/lod2"
      ],
      materials: [
        "stone",
        "dark",
        "wood",
        "iron"
      ],
      nodes: [
        "castle-tower"
      ],
      note: "portal faces +Z; wall walk floor at 17.6 m; masonry texture tiles every 3.6 m",
      sha256: "efd3b848b6b59d724635b77f06d82751bf6cb62333c55e1b4ffcf88e349c7954",
      source: {
        procedural: {
          builder: "castle_tower",
          params: {},
          script: "scripts/props_b.py",
          script_sha256: "f0050ddc5cc0b269469e725adab8dc39dc896f924b1d8f2e68fd60f1fb7b38fc"
        }
      },
      tris: 1477
    },
    "model/castle-tower/lod1": {
      bounds_m: [
        [
          -5.25,
          0,
          -5.25
        ],
        [
          5.25,
          19.799999999999997,
          5.26
        ]
      ],
      bytes: 43500,
      emissive: [],
      file: "35cb812d0abe59239f7e9789567da8f6f3fa2999d9973af254dca1872c425a2f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/castle-tower/lod0",
        "model/castle-tower/lod1",
        "model/castle-tower/lod2"
      ],
      materials: [
        "stone",
        "dark",
        "wood"
      ],
      nodes: [
        "castle-tower"
      ],
      note: "portal faces +Z; wall walk floor at 17.6 m; masonry texture tiles every 3.6 m",
      sha256: "35cb812d0abe59239f7e9789567da8f6f3fa2999d9973af254dca1872c425a2f",
      source: {
        procedural: {
          builder: "castle_tower",
          params: {},
          script: "scripts/props_b.py",
          script_sha256: "f0050ddc5cc0b269469e725adab8dc39dc896f924b1d8f2e68fd60f1fb7b38fc"
        }
      },
      tris: 711
    },
    "model/castle-tower/lod2": {
      bounds_m: [
        [
          -5.25,
          0,
          -5.25
        ],
        [
          5.25,
          19.799999999999997,
          5.26
        ]
      ],
      bytes: 24228,
      emissive: [],
      file: "06610a0f5b724df1d8bdfd55c1eeed35c3ebb9950ee20d7387b73960f418240e.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/castle-tower/lod0",
        "model/castle-tower/lod1",
        "model/castle-tower/lod2"
      ],
      materials: [
        "stone",
        "wood"
      ],
      nodes: [
        "castle-tower"
      ],
      note: "portal faces +Z; wall walk floor at 17.6 m; masonry texture tiles every 3.6 m",
      sha256: "06610a0f5b724df1d8bdfd55c1eeed35c3ebb9950ee20d7387b73960f418240e",
      source: {
        procedural: {
          builder: "castle_tower",
          params: {},
          script: "scripts/props_b.py",
          script_sha256: "f0050ddc5cc0b269469e725adab8dc39dc896f924b1d8f2e68fd60f1fb7b38fc"
        }
      },
      tris: 389
    },
    "model/chapel-alpine/lod0": {
      bounds_m: [
        [
          -16.997915709593222,
          -2.0000000000029896,
          -13.99815573016613
        ],
        [
          16.999022568674764,
          28.45612094236545,
          13.99741825759492
        ]
      ],
      bytes: 1170196,
      emissive: [],
      file: "29cc6dcf11407c05c4cca30130cac7a4993228748a6a9a29ca40a2715a41adb6.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/chapel-alpine/lod0",
        "model/chapel-alpine/lod1",
        "model/chapel-alpine/lod2"
      ],
      materials: [
        "wall",
        "roof",
        "dome",
        "dark",
        "knoll"
      ],
      nodes: [
        null
      ],
      note: "an alpine ridge chapel on a rock knoll, 28 m: white walls, a steep red-brown roof, a slim tower under a copper onion dome; the door at -X, the tower at +X; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "29cc6dcf11407c05c4cca30130cac7a4993228748a6a9a29ca40a2715a41adb6",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "1c3920cea4ec04ab9703347753441bd48a383e716a567dc39871f86300c23eb6.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a small white alpine chapel with a steep red roof and a slim bell tower under a green copper onion dome, on a grey rock knoll",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "chapel-alpine",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 24e3
    },
    "model/chapel-alpine/lod1": {
      bounds_m: [
        [
          -16.982985571809646,
          -2.0000000000015667,
          -13.998119614305748
        ],
        [
          16.99785746578298,
          28.47175410098258,
          13.998534980641049
        ]
      ],
      bytes: 371484,
      emissive: [],
      file: "a7916523af28559679e65cf2c18bacfb51df60d8488e386e119620efd5da9dbb.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/chapel-alpine/lod0",
        "model/chapel-alpine/lod1",
        "model/chapel-alpine/lod2"
      ],
      materials: [
        "wall",
        "roof",
        "dome",
        "dark",
        "knoll"
      ],
      nodes: [
        null
      ],
      note: "an alpine ridge chapel on a rock knoll, 28 m: white walls, a steep red-brown roof, a slim tower under a copper onion dome; the door at -X, the tower at +X; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "a7916523af28559679e65cf2c18bacfb51df60d8488e386e119620efd5da9dbb",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "76e6636e37c45347edd4dec490a201ff3dd70f74e75bf81364d8a29b6d760de5.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a small white alpine chapel with a steep red roof and a slim bell tower under a green copper onion dome, on a grey rock knoll",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "chapel-alpine",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 6e3
    },
    "model/chapel-alpine/lod2": {
      bounds_m: [
        [
          -16.99085269610278,
          -2,
          -13.99917569930722
        ],
        [
          16.973965843408653,
          28.47970613266291,
          13.979016715855794
        ]
      ],
      bytes: 133376,
      emissive: [],
      file: "637551f0d751447d1218ede96cad4859a4ca14f734579242416fea1663b07bfb.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/chapel-alpine/lod0",
        "model/chapel-alpine/lod1",
        "model/chapel-alpine/lod2"
      ],
      materials: [
        "wall",
        "roof",
        "dome",
        "dark",
        "knoll"
      ],
      nodes: [
        null
      ],
      note: "an alpine ridge chapel on a rock knoll, 28 m: white walls, a steep red-brown roof, a slim tower under a copper onion dome; the door at -X, the tower at +X; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "637551f0d751447d1218ede96cad4859a4ca14f734579242416fea1663b07bfb",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "c33e0b278e8c08ef0880da716dfa5cf4d1fbc7e258388dd4e6545546a206e5f6.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a small white alpine chapel with a steep red roof and a slim bell tower under a green copper onion dome, on a grey rock knoll",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "chapel-alpine",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 1600
    },
    "model/chapel-tuscan/lod0": {
      bounds_m: [
        [
          -16.99921617502397,
          -2.0000000000029896,
          -13.998916032442173
        ],
        [
          16.999022568674764,
          31.911520173903227,
          13.999417765112117
        ]
      ],
      bytes: 1164928,
      emissive: [],
      file: "15def039fd14ddce110e43c0cd204aa1ec4a7779c0b1bfcc08bb52c2b4bd4c4c.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/chapel-tuscan/lod0",
        "model/chapel-tuscan/lod1",
        "model/chapel-tuscan/lod2"
      ],
      materials: [
        "wall",
        "roof",
        "dark",
        "knoll"
      ],
      nodes: [
        null
      ],
      note: "a Tuscan hill chapel on a grass knoll, 32 m: ochre walls, terracotta roof, a square campanile under a low pyramid roof; the door at -X, the tower at +X; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "15def039fd14ddce110e43c0cd204aa1ec4a7779c0b1bfcc08bb52c2b4bd4c4c",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "0fce57fb2b05f830bb4db80bd051f0ef2ef21a9ef226cce09aa8513fab646f51.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a small ochre Tuscan hill chapel with a terracotta roof and a square bell tower, on a green grass knoll",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "chapel-tuscan",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 24e3
    },
    "model/chapel-tuscan/lod1": {
      bounds_m: [
        [
          -16.988477527607923,
          -2.0000000000013216,
          -13.997372003827317
        ],
        [
          16.99494789049284,
          31.899641279422568,
          13.993956479059397
        ]
      ],
      bytes: 375076,
      emissive: [],
      file: "29a9dd389660dca5460131f303386df7287a00d13292e07cf999accd2114abba.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/chapel-tuscan/lod0",
        "model/chapel-tuscan/lod1",
        "model/chapel-tuscan/lod2"
      ],
      materials: [
        "wall",
        "roof",
        "dark",
        "knoll"
      ],
      nodes: [
        null
      ],
      note: "a Tuscan hill chapel on a grass knoll, 32 m: ochre walls, terracotta roof, a square campanile under a low pyramid roof; the door at -X, the tower at +X; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "29a9dd389660dca5460131f303386df7287a00d13292e07cf999accd2114abba",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "7da7d6cd82246834492245748ccc98bd2b3a03e4b2ffcef9ebe795b0c5a7f1e7.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a small ochre Tuscan hill chapel with a terracotta roof and a square bell tower, on a green grass knoll",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "chapel-tuscan",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 6e3
    },
    "model/chapel-tuscan/lod2": {
      bounds_m: [
        [
          -16.969180085290557,
          -2.0000000000000004,
          -13.964671051248708
        ],
        [
          16.996982863674113,
          31.944920398172602,
          13.958061365680592
        ]
      ],
      bytes: 135708,
      emissive: [],
      file: "173c5c3584427e3d2537f78e31f158f03a8db26879aa46c926d973cd7200fe74.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/chapel-tuscan/lod0",
        "model/chapel-tuscan/lod1",
        "model/chapel-tuscan/lod2"
      ],
      materials: [
        "wall",
        "roof",
        "dark",
        "knoll"
      ],
      nodes: [
        null
      ],
      note: "a Tuscan hill chapel on a grass knoll, 32 m: ochre walls, terracotta roof, a square campanile under a low pyramid roof; the door at -X, the tower at +X; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "173c5c3584427e3d2537f78e31f158f03a8db26879aa46c926d973cd7200fe74",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "d5597cfbab973bb36dc96c82823527adfb23cebf016376a1d75f852840de4779.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a small ochre Tuscan hill chapel with a terracotta roof and a square bell tower, on a green grass knoll",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "chapel-tuscan",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 1600
    },
    "model/cliff-coast-a/lod0": {
      bounds_m: [
        [
          -15.542663987176995,
          -2,
          -12.922756450659065
        ],
        [
          15.542663987176995,
          25.2,
          12.922756450659065
        ]
      ],
      bytes: 2006684,
      emissive: [],
      file: "7bfa2f66c30cb64383c33e17511902fb34fcd93faf00981e6c9d5396b8b78718.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/cliff-coast-a/lod0",
        "model/cliff-coast-a/lod1",
        "model/cliff-coast-a/lod2"
      ],
      materials: [
        "rock",
        "grass"
      ],
      nodes: [
        null
      ],
      note: "sea stack, 24 m: a rounded, fluted grey rock wall over a scree foot, a rounded shoulder and a domed grass cap; closed, skirt to y = -2 m, materials rock, grass (no textures); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "7bfa2f66c30cb64383c33e17511902fb34fcd93faf00981e6c9d5396b8b78718",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "acd572ea92d41e080090e71979c7abd3e473f1411392f8b4a36e0604aafd3e78.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a rounded grey coastal sea stack, fluted weathered rock under a grassy cap",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "cliff-coast-a",
          params: {},
          script: "props/landforms.py",
          script_sha256: "5fe4b2b262a95c919c0ea061b02ddbfd55be9ed8eeb827558fd2c14ed5437af6"
        }
      },
      tris: 4284
    },
    "model/cliff-coast-a/lod1": {
      bounds_m: [
        [
          -15.465248868851246,
          -2,
          -12.923097354029506
        ],
        [
          15.494761486661412,
          25.2,
          12.897355307960007
        ]
      ],
      bytes: 817088,
      emissive: [],
      file: "1bbedea428cc2050bf2443e62ae1bb8f76a8ed2398311d7e693c9136dc89adcc.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/cliff-coast-a/lod0",
        "model/cliff-coast-a/lod1",
        "model/cliff-coast-a/lod2"
      ],
      materials: [
        "rock",
        "grass"
      ],
      nodes: [
        null
      ],
      note: "sea stack, 24 m: a rounded, fluted grey rock wall over a scree foot, a rounded shoulder and a domed grass cap; closed, skirt to y = -2 m, materials rock, grass (no textures); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "1bbedea428cc2050bf2443e62ae1bb8f76a8ed2398311d7e693c9136dc89adcc",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "8c9868f87808b8951d1dd6db8f46cd1c4ff5772c72db9af7ee9aba8d08bd9a1d.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a rounded grey coastal sea stack, fluted weathered rock under a grassy cap",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "cliff-coast-a",
          params: {},
          script: "props/landforms.py",
          script_sha256: "5fe4b2b262a95c919c0ea061b02ddbfd55be9ed8eeb827558fd2c14ed5437af6"
        }
      },
      tris: 1050
    },
    "model/cliff-coast-a/lod2": {
      bounds_m: [
        [
          -15.334328340773059,
          -2,
          -12.926033600924919
        ],
        [
          14.286456688456871,
          25.199999999999996,
          12.897355307960007
        ]
      ],
      bytes: 507708,
      emissive: [],
      file: "4acda2ebb1e96efbb345116b42c09ae63d2721e5088286d7141d9b927001cf12.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/cliff-coast-a/lod0",
        "model/cliff-coast-a/lod1",
        "model/cliff-coast-a/lod2"
      ],
      materials: [
        "rock",
        "grass"
      ],
      nodes: [
        null
      ],
      note: "sea stack, 24 m: a rounded, fluted grey rock wall over a scree foot, a rounded shoulder and a domed grass cap; closed, skirt to y = -2 m, materials rock, grass (no textures); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "4acda2ebb1e96efbb345116b42c09ae63d2721e5088286d7141d9b927001cf12",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "cdfb60f07a45e014d3b65f27bdfd36507308767a539a9294cfce0a192a8f9443.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a rounded grey coastal sea stack, fluted weathered rock under a grassy cap",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "cliff-coast-a",
          params: {},
          script: "props/landforms.py",
          script_sha256: "5fe4b2b262a95c919c0ea061b02ddbfd55be9ed8eeb827558fd2c14ed5437af6"
        }
      },
      tris: 252
    },
    "model/cliff-coast-b/lod0": {
      bounds_m: [
        [
          -18.287927094769152,
          -2,
          -14.035024346926432
        ],
        [
          18.287927094769152,
          23,
          14.035024346926432
        ]
      ],
      bytes: 2008704,
      emissive: [],
      file: "884f1f38b951de027896616fa069ab2be622041642e288a17b2a3d3622148f59.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/cliff-coast-b/lod0",
        "model/cliff-coast-b/lod1",
        "model/cliff-coast-b/lod2"
      ],
      materials: [
        "rock",
        "grass"
      ],
      nodes: [
        null
      ],
      note: "elongated headland, 22 m: a rounded, fluted grey rock wall over a scree foot, a rounded shoulder and a domed grass cap; closed, skirt to y = -2 m, materials rock, grass (no textures); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "884f1f38b951de027896616fa069ab2be622041642e288a17b2a3d3622148f59",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "3f1c4038ec51e4093d8f5c8d0800764237526b8121f7dc7133e8002df8ec2fb7.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a rounded grey coastal sea stack, fluted weathered rock under a grassy cap",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "cliff-coast-b",
          params: {},
          script: "props/landforms.py",
          script_sha256: "5fe4b2b262a95c919c0ea061b02ddbfd55be9ed8eeb827558fd2c14ed5437af6"
        }
      },
      tris: 4896
    },
    "model/cliff-coast-b/lod1": {
      bounds_m: [
        [
          -18.21515350497997,
          -2,
          -14.035255303393368
        ],
        [
          18.285418540890667,
          23,
          14.053742884008324
        ]
      ],
      bytes: 811784,
      emissive: [],
      file: "f1057ec0bba1dd9ab7035a6ad9b59c74db6615ee7b33a30b9ccc2255c115fa78.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/cliff-coast-b/lod0",
        "model/cliff-coast-b/lod1",
        "model/cliff-coast-b/lod2"
      ],
      materials: [
        "rock",
        "grass"
      ],
      nodes: [
        null
      ],
      note: "elongated headland, 22 m: a rounded, fluted grey rock wall over a scree foot, a rounded shoulder and a domed grass cap; closed, skirt to y = -2 m, materials rock, grass (no textures); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "f1057ec0bba1dd9ab7035a6ad9b59c74db6615ee7b33a30b9ccc2255c115fa78",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "a2f14c4600e8704a6e676569a340e26d77353ff7d3b9aafc9ad9e3703b2fbd4f.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a rounded grey coastal sea stack, fluted weathered rock under a grassy cap",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "cliff-coast-b",
          params: {},
          script: "props/landforms.py",
          script_sha256: "5fe4b2b262a95c919c0ea061b02ddbfd55be9ed8eeb827558fd2c14ed5437af6"
        }
      },
      tris: 1200
    },
    "model/cliff-coast-b/lod2": {
      bounds_m: [
        [
          -17.13585642175976,
          -2,
          -13.998780788228165
        ],
        [
          17.098287476859518,
          23,
          13.230205225082925
        ]
      ],
      bytes: 498112,
      emissive: [],
      file: "95335f7916c2ec6c886b9e77d5223a9d8ab49fcfcada8b2a351906902436390b.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/cliff-coast-b/lod0",
        "model/cliff-coast-b/lod1",
        "model/cliff-coast-b/lod2"
      ],
      materials: [
        "rock",
        "grass"
      ],
      nodes: [
        null
      ],
      note: "elongated headland, 22 m: a rounded, fluted grey rock wall over a scree foot, a rounded shoulder and a domed grass cap; closed, skirt to y = -2 m, materials rock, grass (no textures); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "95335f7916c2ec6c886b9e77d5223a9d8ab49fcfcada8b2a351906902436390b",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "b8404571cb10377e67c4a731113b54ea430c80702d7e3aa3107f2a02c36d39ea.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a rounded grey coastal sea stack, fluted weathered rock under a grassy cap",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "cliff-coast-b",
          params: {},
          script: "props/landforms.py",
          script_sha256: "5fe4b2b262a95c919c0ea061b02ddbfd55be9ed8eeb827558fd2c14ed5437af6"
        }
      },
      tris: 288
    },
    "model/clock-tower/lod0": {
      bounds_m: [
        [
          -16.99998487593635,
          -2.0000000000029896,
          -13.999490775400036
        ],
        [
          16.999747714305244,
          39.22314177020582,
          13.99741825759492
        ]
      ],
      bytes: 1205092,
      emissive: [],
      file: "d326a13787d1cb22e000d1c98aacc8591fb7ccc85430667160810921d2b1a364.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/clock-tower/lod0",
        "model/clock-tower/lod1",
        "model/clock-tower/lod2"
      ],
      materials: [
        "wall",
        "roof",
        "dome",
        "dark",
        "knoll"
      ],
      nodes: [
        null
      ],
      note: "a harbour clock tower on a rock knoll, 39 m: white walls, a green copper spire over clock faces; the door at -X, the tower at +X; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "d326a13787d1cb22e000d1c98aacc8591fb7ccc85430667160810921d2b1a364",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "26438211e13891e2b78f597a411d386ddedcb32aee8e2602205512bf0cfa1541.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a white harbour clock tower with a green copper spire beside a small chapel, on a grey rock knoll",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "clock-tower",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 24e3
    },
    "model/clock-tower/lod1": {
      bounds_m: [
        [
          -16.999844438834472,
          -2.000000000001251,
          -13.99219714657263
        ],
        [
          16.995704145136227,
          39.23113151805546,
          13.994936682696489
        ]
      ],
      bytes: 408552,
      emissive: [],
      file: "fa4f861be239db90fc2ca78eb7cdff7d1af1d39f835a0eb21173a9288d60cee8.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/clock-tower/lod0",
        "model/clock-tower/lod1",
        "model/clock-tower/lod2"
      ],
      materials: [
        "wall",
        "roof",
        "dome",
        "dark",
        "knoll"
      ],
      nodes: [
        null
      ],
      note: "a harbour clock tower on a rock knoll, 39 m: white walls, a green copper spire over clock faces; the door at -X, the tower at +X; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "fa4f861be239db90fc2ca78eb7cdff7d1af1d39f835a0eb21173a9288d60cee8",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "7464b6b45181a2d5679e2882e82d11a123bf3175f8c309b225cf52ed7386380d.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a white harbour clock tower with a green copper spire beside a small chapel, on a grey rock knoll",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "clock-tower",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 6e3
    },
    "model/clock-tower/lod2": {
      bounds_m: [
        [
          -16.994758758418413,
          -2,
          -13.959866234007851
        ],
        [
          16.9870500360686,
          39.16986861199822,
          13.963131903071432
        ]
      ],
      bytes: 136244,
      emissive: [],
      file: "6d40bd6abc1e0c36c15f98c3a6a762084f67203626d8a5204070ad58e6e78e98.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/clock-tower/lod0",
        "model/clock-tower/lod1",
        "model/clock-tower/lod2"
      ],
      materials: [
        "wall",
        "roof",
        "dome",
        "dark",
        "knoll"
      ],
      nodes: [
        null
      ],
      note: "a harbour clock tower on a rock knoll, 39 m: white walls, a green copper spire over clock faces; the door at -X, the tower at +X; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "6d40bd6abc1e0c36c15f98c3a6a762084f67203626d8a5204070ad58e6e78e98",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "1273c5fb68a45fdc1568ee63ccf0a95fdafa41d3729b82953a1a8a47fcc7df32.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a white harbour clock tower with a green copper spire beside a small chapel, on a grey rock knoll",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "clock-tower",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 1600
    },
    "model/colosseum/lod0": {
      bounds_m: [
        [
          -90.74972259415652,
          0,
          -75.74986610482244
        ],
        [
          90.74972259415652,
          47.5,
          75.74986610482244
        ]
      ],
      bytes: 2030112,
      emissive: [],
      file: "e932dc77d7dd5900eeb16c09c8b19fa93303b2a3ff3233aadb4ca7dadec31787.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/colosseum/lod0",
        "model/colosseum/lod1",
        "model/colosseum/lod2"
      ],
      materials: [
        "stone",
        "shade",
        "shade_deep",
        "seats",
        "sand"
      ],
      nodes: [
        "colosseum"
      ],
      note: "outer ring ruined to its first storey around -Z (bays within 38 deg of 270 deg), stepped up over 11 deg either side; arena long axis along X",
      sha256: "e932dc77d7dd5900eeb16c09c8b19fa93303b2a3ff3233aadb4ca7dadec31787",
      source: {
        procedural: {
          builder: "colosseum",
          params: {},
          script: "scripts/props_b.py",
          script_sha256: "f0050ddc5cc0b269469e725adab8dc39dc896f924b1d8f2e68fd60f1fb7b38fc"
        }
      },
      tris: 35430
    },
    "model/colosseum/lod1": {
      bounds_m: [
        [
          -90.70628763539985,
          0,
          -75.60376917907223
        ],
        [
          90.70628763539985,
          47.5,
          75.70453372650088
        ]
      ],
      bytes: 556300,
      emissive: [],
      file: "9155bac2b6210d7b4223d70db07667e378d402d9ce8cad25b9b3ead11ab904ee.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/colosseum/lod0",
        "model/colosseum/lod1",
        "model/colosseum/lod2"
      ],
      materials: [
        "stone",
        "shade",
        "shade_deep",
        "seats",
        "sand"
      ],
      nodes: [
        "colosseum"
      ],
      note: "outer ring ruined to its first storey around -Z (bays within 38 deg of 270 deg), stepped up over 11 deg either side; arena long axis along X",
      sha256: "9155bac2b6210d7b4223d70db07667e378d402d9ce8cad25b9b3ead11ab904ee",
      source: {
        procedural: {
          builder: "colosseum",
          params: {},
          script: "scripts/props_b.py",
          script_sha256: "f0050ddc5cc0b269469e725adab8dc39dc896f924b1d8f2e68fd60f1fb7b38fc"
        }
      },
      tris: 10966
    },
    "model/colosseum/lod2": {
      bounds_m: [
        [
          -90,
          0,
          -75
        ],
        [
          90,
          45,
          75
        ]
      ],
      bytes: 95600,
      emissive: [],
      file: "9a90ce5525de773ff9e25a6af9e72ab196c15867baa8977d211d478d49cefc58.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/colosseum/lod0",
        "model/colosseum/lod1",
        "model/colosseum/lod2"
      ],
      materials: [
        "stone",
        "shade",
        "seats",
        "sand"
      ],
      nodes: [
        "colosseum"
      ],
      note: "outer ring ruined to its first storey around -Z (bays within 38 deg of 270 deg), stepped up over 11 deg either side; arena long axis along X",
      sha256: "9a90ce5525de773ff9e25a6af9e72ab196c15867baa8977d211d478d49cefc58",
      source: {
        procedural: {
          builder: "colosseum",
          params: {},
          script: "scripts/props_b.py",
          script_sha256: "f0050ddc5cc0b269469e725adab8dc39dc896f924b1d8f2e68fd60f1fb7b38fc"
        }
      },
      tris: 1520
    },
    "model/column/lod0": {
      bounds_m: [
        [
          -0.88,
          0,
          -0.7199999800109863
        ],
        [
          0.88,
          5.2,
          0.7195514722270993
        ]
      ],
      bytes: 285544,
      emissive: [],
      file: "1bac95853689c750c6486b455f99ad3eef2b8f1900f29d6e9797acf64ea61956.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/column/lod0",
        "model/column/lod1",
        "model/column/lod2"
      ],
      materials: [
        "marble"
      ],
      nodes: [
        "column"
      ],
      note: "Ionic column, 5.2 m: square plinth, Attic base (two tori, scotia), a lathed shaft of 24 flutes with entasis and rounded flute ends, astragal and echinus, a volute capital (two drums whose faces carry a cartoon scroll of rings, front and back on +-z, joined by a cushion), thin abacus, weathered chips off the plinth; separate closed shells; material marble (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "1bac95853689c750c6486b455f99ad3eef2b8f1900f29d6e9797acf64ea61956",
      source: {
        baked: {
          atlas_px: [
            1024,
            512,
            256
          ],
          from: "a10702bcb5adb36dd37249cd0266c546d7da628eb7bc2ac85f34a4a6d4c05068.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a weathered white marble roman column",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "column",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/props.py",
          script_sha256: "0401b56caf40ace7f76cc450c7184193146b42aa9c7b3fc73c94b22159c3bc17"
        }
      },
      stages: [
        "ancient-ruins",
        "destination-colosseum"
      ],
      tris: 3794,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/column/lod1": {
      bounds_m: [
        [
          -0.8712132034355964,
          0,
          -0.7142875207623132
        ],
        [
          0.8712132034355964,
          5.1960995173889,
          0.7194389647736483
        ]
      ],
      bytes: 92424,
      emissive: [],
      file: "53aaae3fec7581985c1281b4c4828f132d3df9112a7ddcfc0f0d6495025201be.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/column/lod0",
        "model/column/lod1",
        "model/column/lod2"
      ],
      materials: [
        "marble"
      ],
      nodes: [
        "column"
      ],
      note: "Ionic column, 5.2 m: square plinth, Attic base (two tori, scotia), a lathed shaft of 24 flutes with entasis and rounded flute ends, astragal and echinus, a volute capital (two drums whose faces carry a cartoon scroll of rings, front and back on +-z, joined by a cushion), thin abacus, weathered chips off the plinth; separate closed shells; material marble (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "53aaae3fec7581985c1281b4c4828f132d3df9112a7ddcfc0f0d6495025201be",
      source: {
        baked: {
          atlas_px: [
            1024,
            512,
            256
          ],
          from: "aca9c275e74e0f354cd2a2527f48448936f4be1c91301f30c62749cb2777f54b.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a weathered white marble roman column",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "column",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/props.py",
          script_sha256: "0401b56caf40ace7f76cc450c7184193146b42aa9c7b3fc73c94b22159c3bc17"
        }
      },
      stages: [
        "ancient-ruins",
        "destination-colosseum"
      ],
      tris: 1066,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/column/lod2": {
      bounds_m: [
        [
          -0.8712132034355964,
          0,
          -0.7142875207623132
        ],
        [
          0.8712132034355964,
          5.1960995173889,
          0.7193042637476114
        ]
      ],
      bytes: 30404,
      emissive: [],
      file: "685bf0bfa0dc84da0ef12b2a8fac3ce2dc947734bb3dc683be1540f63427e548.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/column/lod0",
        "model/column/lod1",
        "model/column/lod2"
      ],
      materials: [
        "marble"
      ],
      nodes: [
        "column"
      ],
      note: "Ionic column, 5.2 m: square plinth, Attic base (two tori, scotia), a lathed shaft of 24 flutes with entasis and rounded flute ends, astragal and echinus, a volute capital (two drums whose faces carry a cartoon scroll of rings, front and back on +-z, joined by a cushion), thin abacus, weathered chips off the plinth; separate closed shells; material marble (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "685bf0bfa0dc84da0ef12b2a8fac3ce2dc947734bb3dc683be1540f63427e548",
      source: {
        baked: {
          atlas_px: [
            1024,
            512,
            256
          ],
          from: "55e1d44da484a77a39e6602a09786b11a03de4c7854e11115f239f5a1dbc38d0.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a weathered white marble roman column",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "column",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/props.py",
          script_sha256: "0401b56caf40ace7f76cc450c7184193146b42aa9c7b3fc73c94b22159c3bc17"
        }
      },
      stages: [
        "ancient-ruins",
        "destination-colosseum"
      ],
      tris: 294,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/cypress/lod0": {
      bounds_m: [
        [
          -1.0744095693110531,
          0,
          -1.0367620424028352
        ],
        [
          1.0744095693110531,
          10,
          1.0367620424028352
        ]
      ],
      bytes: 268296,
      emissive: [],
      file: "b2251eb9a3e4259f0d49a5b5231c3ec525e0a675861878e04a1ddbc45620c2ec.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/cypress/lod0",
        "model/cypress/lod1",
        "model/cypress/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "cypress"
      ],
      note: "solid stylised crown (no alpha cards); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "b2251eb9a3e4259f0d49a5b5231c3ec525e0a675861878e04a1ddbc45620c2ec",
      source: {
        baked: {
          atlas_px: [
            1024,
            512,
            256
          ],
          from: "00feda07b4b16fdea76d5b04e702116daaee6d4ab5e80b5e928c040ac8d7d4ca.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall slender Italian cypress tree, dense dark green foliage with warm lit edges",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "cypress",
          params: {},
          script: "scripts/props_b.py",
          script_sha256: "f0050ddc5cc0b269469e725adab8dc39dc896f924b1d8f2e68fd60f1fb7b38fc"
        }
      },
      tris: 4676
    },
    "model/cypress/lod1": {
      bounds_m: [
        [
          -1.0433243105059349,
          0,
          -1.012118119362166
        ],
        [
          1.0703511810854467,
          10,
          1.035443271369544
        ]
      ],
      bytes: 65080,
      emissive: [],
      file: "34743964d21f68e24b6493b5d6f37ac46420abc11b9f40a4db620f5c22fe6f99.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/cypress/lod0",
        "model/cypress/lod1",
        "model/cypress/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "cypress"
      ],
      note: "solid stylised crown (no alpha cards); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "34743964d21f68e24b6493b5d6f37ac46420abc11b9f40a4db620f5c22fe6f99",
      source: {
        baked: {
          atlas_px: [
            1024,
            512,
            256
          ],
          from: "ce7b9f5ab8c3f8863faa4e484a45f331412a6cb8e660957de4eb941986808172.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall slender Italian cypress tree, dense dark green foliage with warm lit edges",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "cypress",
          params: {},
          script: "scripts/props_b.py",
          script_sha256: "f0050ddc5cc0b269469e725adab8dc39dc896f924b1d8f2e68fd60f1fb7b38fc"
        }
      },
      tris: 864
    },
    "model/cypress/lod2": {
      bounds_m: [
        [
          -0.889976360763511,
          0,
          -0.8210063451213703
        ],
        [
          0.7691835707272355,
          10,
          0.8381535863693763
        ]
      ],
      bytes: 13988,
      emissive: [],
      file: "c642d24d6c96bf7b4384418a8f891df2d1d468471967ad656b1532fc66c10500.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/cypress/lod0",
        "model/cypress/lod1",
        "model/cypress/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "cypress"
      ],
      note: "solid stylised crown (no alpha cards); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "c642d24d6c96bf7b4384418a8f891df2d1d468471967ad656b1532fc66c10500",
      source: {
        baked: {
          atlas_px: [
            1024,
            512,
            256
          ],
          from: "f554a9ed8d6614f3126b8ae33c850d6ad279074a7aa481ad964fb69e79a83715.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall slender Italian cypress tree, dense dark green foliage with warm lit edges",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "cypress",
          params: {},
          script: "scripts/props_b.py",
          script_sha256: "f0050ddc5cc0b269469e725adab8dc39dc896f924b1d8f2e68fd60f1fb7b38fc"
        }
      },
      tris: 122
    },
    "model/deadwood-log/lod0": {
      bounds_m: [
        [
          -1.5255075097084045,
          0,
          -0.13876375555992126
        ],
        [
          1.5255075097084045,
          0.29043155536055565,
          0.13876375555992126
        ]
      ],
      build: {
        budget: 1e4,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 943736,
      file: "655af55e6b3e16ca758cdd0636d091bfc93e29bf0e1230d18a8ccfe7c3e5a64d.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/deadwood-log/lod0",
        "model/deadwood-log/lod1",
        "model/deadwood-log/lod2"
      ],
      sha256: "655af55e6b3e16ca758cdd0636d091bfc93e29bf0e1230d18a8ccfe7c3e5a64d",
      source: {
        polyhaven: {
          id: "dead_tree_trunk",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/dead_tree_trunk/dead_tree_trunk_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 101802
      },
      stages: [
        "wilderness-run",
        "alpine-peaks"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 1024
      },
      tris: 1e4
    },
    "model/deadwood-log/lod1": {
      bounds_m: [
        [
          -1.5255075097084045,
          0,
          -0.13876375555992126
        ],
        [
          1.5255075097084045,
          0.29043155536055565,
          0.13876375555992126
        ]
      ],
      build: {
        budget: 1e4,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 264464,
      file: "ca7ba5595dfc046da195b8e48b824bbbe4d292ee4937f2be5d795aaca55722fd.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/deadwood-log/lod0",
        "model/deadwood-log/lod1",
        "model/deadwood-log/lod2"
      ],
      sha256: "ca7ba5595dfc046da195b8e48b824bbbe4d292ee4937f2be5d795aaca55722fd",
      source: {
        polyhaven: {
          id: "dead_tree_trunk",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/dead_tree_trunk/dead_tree_trunk_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 101802
      },
      stages: [
        "wilderness-run",
        "alpine-peaks"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 512
      },
      tris: 2498
    },
    "model/deadwood-log/lod2": {
      bounds_m: [
        [
          -1.5255075097084045,
          0,
          -0.13876375555992126
        ],
        [
          1.5255075097084045,
          0.29043155536055565,
          0.13876375555992126
        ]
      ],
      build: {
        budget: 1e4,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 42184,
      file: "214cf22c066c6a7c4d53898ee15aa06379000d87f6d5d596a9e929118a3da903.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/deadwood-log/lod0",
        "model/deadwood-log/lod1",
        "model/deadwood-log/lod2"
      ],
      sha256: "214cf22c066c6a7c4d53898ee15aa06379000d87f6d5d596a9e929118a3da903",
      source: {
        polyhaven: {
          id: "dead_tree_trunk",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/dead_tree_trunk/dead_tree_trunk_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 101802
      },
      stages: [
        "wilderness-run",
        "alpine-peaks"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 256
      },
      tris: 600
    },
    "model/deadwood-quiver/lod0": {
      bounds_m: [
        [
          -0.1532365009188652,
          0,
          -0.13404320180416107
        ],
        [
          0.1532365009188652,
          1.9941055634990335,
          0.13404320180416107
        ]
      ],
      build: {
        budget: 8e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 604460,
      file: "2c8449a52b9cd55efe9d9faf4a9e0dd84173480311f74c9b5c8af1988e806c6c.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/deadwood-quiver/lod0",
        "model/deadwood-quiver/lod1",
        "model/deadwood-quiver/lod2"
      ],
      sha256: "2c8449a52b9cd55efe9d9faf4a9e0dd84173480311f74c9b5c8af1988e806c6c",
      source: {
        polyhaven: {
          id: "dead_quiver_trunk",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/dead_quiver_trunk/dead_quiver_trunk_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 17978
      },
      stages: [
        "desert-canyons",
        "sunset-highway"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 1024
      },
      tris: 7998
    },
    "model/deadwood-quiver/lod1": {
      bounds_m: [
        [
          -0.1532365009188652,
          0,
          -0.13404320180416107
        ],
        [
          0.1532365009188652,
          1.9941055634990335,
          0.13404320180416107
        ]
      ],
      build: {
        budget: 8e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 183424,
      file: "3b208afb364314ef5d12b8b6cdd8892c414fbf1d7bf8fd863c58c89d4996e33a.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/deadwood-quiver/lod0",
        "model/deadwood-quiver/lod1",
        "model/deadwood-quiver/lod2"
      ],
      sha256: "3b208afb364314ef5d12b8b6cdd8892c414fbf1d7bf8fd863c58c89d4996e33a",
      source: {
        polyhaven: {
          id: "dead_quiver_trunk",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/dead_quiver_trunk/dead_quiver_trunk_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 17978
      },
      stages: [
        "desert-canyons",
        "sunset-highway"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 512
      },
      tris: 1998
    },
    "model/deadwood-quiver/lod2": {
      bounds_m: [
        [
          -0.1532365009188652,
          0,
          -0.13404320180416107
        ],
        [
          0.1532365009188652,
          1.9941055634990335,
          0.13404320180416107
        ]
      ],
      build: {
        budget: 8e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 42040,
      file: "37420fa3687900cb9f3792cae32f57b9104274af9e5bb0b9d188741392f54654.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/deadwood-quiver/lod0",
        "model/deadwood-quiver/lod1",
        "model/deadwood-quiver/lod2"
      ],
      sha256: "37420fa3687900cb9f3792cae32f57b9104274af9e5bb0b9d188741392f54654",
      source: {
        polyhaven: {
          id: "dead_quiver_trunk",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/dead_quiver_trunk/dead_quiver_trunk_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 17978
      },
      stages: [
        "desert-canyons",
        "sunset-highway"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 256
      },
      tris: 477
    },
    "model/fern/lod0": {
      bounds_m: [
        [
          -0.5767162134563402,
          -0.04,
          -0.5594990676868359
        ],
        [
          0.5767162134563402,
          0.37699898220063066,
          0.5594990676868359
        ]
      ],
      bytes: 95e3,
      emissive: [],
      file: "30603fe3910dad39b11ba44dda59304f7c41329fba474bc2f2f0729d3538ff61.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/fern/lod0",
        "model/fern/lod1",
        "model/fern/lod2"
      ],
      materials: [
        "frond"
      ],
      nodes: [
        "fern"
      ],
      note: "fern: arching solid fronds (double-sided `frond`), serrated at LOD0",
      sha256: "30603fe3910dad39b11ba44dda59304f7c41329fba474bc2f2f0729d3538ff61",
      source: {
        procedural: {
          builder: "fern",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {},
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run"
      ],
      tris: 3228
    },
    "model/fern/lod1": {
      bounds_m: [
        [
          -0.6224316315975447,
          -0.04,
          -0.6167176813685642
        ],
        [
          0.5321316561143434,
          0.37322648981184103,
          0.6539612138578569
        ]
      ],
      bytes: 15e3,
      emissive: [],
      file: "20c4a4dd97c98f3aa22b1cebb31c8b072d23c49fc26c7b77a064944cf7aa6b9d.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/fern/lod0",
        "model/fern/lod1",
        "model/fern/lod2"
      ],
      materials: [
        "frond"
      ],
      nodes: [
        "fern"
      ],
      note: "fern: arching solid fronds (double-sided `frond`), serrated at LOD0",
      sha256: "20c4a4dd97c98f3aa22b1cebb31c8b072d23c49fc26c7b77a064944cf7aa6b9d",
      source: {
        procedural: {
          builder: "fern",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {},
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run"
      ],
      tris: 396
    },
    "model/fern/lod2": {
      bounds_m: [
        [
          -0.4832919698853039,
          -0.04,
          -0.5633082637418538
        ],
        [
          0.5147770352576946,
          0.3390992589027712,
          0.6371888285736276
        ]
      ],
      bytes: 5020,
      emissive: [],
      file: "0f4406490d78732b01e92757dcbfd98dfed92b008da8dbff0737a1c6456e8dc1.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/fern/lod0",
        "model/fern/lod1",
        "model/fern/lod2"
      ],
      materials: [
        "frond"
      ],
      nodes: [
        "fern"
      ],
      note: "fern: arching solid fronds (double-sided `frond`), serrated at LOD0",
      sha256: "0f4406490d78732b01e92757dcbfd98dfed92b008da8dbff0737a1c6456e8dc1",
      source: {
        procedural: {
          builder: "fern",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {},
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run"
      ],
      tris: 102
    },
    "model/flagman/lod0": {
      bounds_m: [
        [
          -1.217,
          0,
          -0.1829565444644312
        ],
        [
          0.5012651873513416,
          1.8574551475877608,
          0.31840723289944944
        ]
      ],
      bytes: 429876,
      emissive: [],
      file: "f2200f5c23bc47fc3a2367000f520346369eaf71a36e0adaf3aaa37a842fdf2e.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/flagman/lod0"
      ],
      materials: [
        "suit",
        "stripe",
        "skin",
        "hair",
        "shades",
        "cap",
        "glove",
        "boot",
        "pole",
        "flag"
      ],
      nodes: [
        "flagman",
        "arm_R",
        "flag"
      ],
      note: "1980s race marshal, cartoon proportions, 1.86 m tall; Y up, metres, origin on the ground between the feet, faces +Z",
      rig: {
        arm_R: {
          measured_babylon: {
            api: "rotationQuaternion = null; rotation.set(0, 0, z) (Babylon 9.31 glTF loader)",
            grip_world_m: {
              "z=+pi/2": [
                0.3,
                1.38,
                0
              ],
              "z=-pi": [
                -0.3,
                1.98,
                0
              ],
              "z=-pi/2": [
                -0.9,
                1.38,
                0
              ],
              "z=0": [
                -0.3,
                0.78,
                0
              ]
            },
            note: "Babylon world: his front (glTF +Z) is world -Z, his right is world -X"
          },
          pivot_frame: "flagman (glTF node translation)",
          pivot_m: [
            -0.3,
            1.38,
            0
          ],
          raise: "arm_R.rotation.z < 0 swings the arm out to his right side and up in his frontal plane; -pi/2 horizontal, -pi straight up; +z swings it across his body (wrong way)",
          raise_axis: "local Z",
          raise_sign: -1,
          rest: "hanging straight down along local -Y"
        },
        flag: {
          cloth: {
            chequer: "6 x 4 squares in COLOR_0, each square its own vertices",
            double_sided: "one layer, material doubleSided",
            fly: "toward flag-local -X (over his head when raised)",
            grid_quads: [
              18,
              12
            ],
            hoist_y_m: [
              -0.12,
              -0.7
            ],
            material: "flag",
            size_m: [
              0.9,
              0.58
            ],
            uv: "TEXCOORD_0: u 0 at the pole -> 1 at the free edge, v along the hoist"
          },
          pivot_frame: "arm_R (the grip, centre of the fist)",
          pivot_m: [
            0,
            -0.6,
            0
          ],
          pole: "along local Y, top +0.07, tip -0.72 (down at rest, up when raised)",
          spin: "flag.rotation.y turns the cloth about the pole"
        },
        tree: "flagman (body, left hand on the hip) > arm_R (right arm) > flag (pole + cloth)"
      },
      sha256: "f2200f5c23bc47fc3a2367000f520346369eaf71a36e0adaf3aaa37a842fdf2e",
      source: {
        procedural: {
          builder: "body, arm, pole, cloth",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "e7cb0bf70cd0338ba93d0989f1b919140d8d1a5bd231c029e8570e32730ec4b1",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/figure.py",
          script_sha256: "dab8812c4638a0668dbe249afcb8598723ea78b09cf29d85c29d299847b7eb36"
        }
      },
      stages: [
        "coconut-beach"
      ],
      tris: 15082,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion on body and arm, the chequer on the flag cloth; a multiplier of baseColor"
    },
    "model/grass-beach/lod0": {
      bounds_m: [
        [
          -0.23308486293952574,
          -0.035,
          -0.15955771810978892
        ],
        [
          0.23308486293952574,
          0.13211510067775123,
          0.15955771810978892
        ]
      ],
      bytes: 13056,
      emissive: [],
      file: "97ec40e57ab75b3bb13bdb35fa4d58b2f55585d9a576fcc73339c64c046e51f4.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/grass-beach/lod0",
        "model/grass-beach/lod1",
        "model/grass-beach/lod2"
      ],
      materials: [
        "grass"
      ],
      nodes: [
        "grass-beach"
      ],
      note: "grass tuft: chunky V-folded blades (double-sided `grass`)",
      sha256: "97ec40e57ab75b3bb13bdb35fa4d58b2f55585d9a576fcc73339c64c046e51f4",
      source: {
        procedural: {
          builder: "grass",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            ax: [
              1,
              0.45
            ],
            blades: [
              11,
              7,
              4
            ],
            colour: "#a9b95e",
            h: [
              0.13,
              0.2
            ],
            lean: [
              0.1,
              0.17
            ],
            seed: 73,
            spread: 0.05,
            w: 0.026
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach"
      ],
      tris: 334
    },
    "model/grass-beach/lod1": {
      bounds_m: [
        [
          -0.1562296247001987,
          -0.035,
          -0.15955771810978892
        ],
        [
          0.23308486293952574,
          0.12312845317537716,
          0.12838497922437792
        ]
      ],
      bytes: 5516,
      emissive: [],
      file: "cfec11ee97327249925ef6d7b348fcff27bf09eb8fde4d758eac78e5908ee84f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/grass-beach/lod0",
        "model/grass-beach/lod1",
        "model/grass-beach/lod2"
      ],
      materials: [
        "grass"
      ],
      nodes: [
        "grass-beach"
      ],
      note: "grass tuft: chunky V-folded blades (double-sided `grass`)",
      sha256: "cfec11ee97327249925ef6d7b348fcff27bf09eb8fde4d758eac78e5908ee84f",
      source: {
        procedural: {
          builder: "grass",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            ax: [
              1,
              0.45
            ],
            blades: [
              11,
              7,
              4
            ],
            colour: "#a9b95e",
            h: [
              0.13,
              0.2
            ],
            lean: [
              0.1,
              0.17
            ],
            seed: 73,
            spread: 0.05,
            w: 0.026
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach"
      ],
      tris: 116
    },
    "model/grass-beach/lod2": {
      bounds_m: [
        [
          -0.13178045914747308,
          -0.035,
          -0.15955771810978892
        ],
        [
          0.23308486293952574,
          0.12186303814362537,
          0.06322336052812538
        ]
      ],
      bytes: 2652,
      emissive: [],
      file: "a88f72e15bf5a2432cf203a413305f5ca9d6eb4b2893b374f084c4b26c6b5f5f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/grass-beach/lod0",
        "model/grass-beach/lod1",
        "model/grass-beach/lod2"
      ],
      materials: [
        "grass"
      ],
      nodes: [
        "grass-beach"
      ],
      note: "grass tuft: chunky V-folded blades (double-sided `grass`)",
      sha256: "a88f72e15bf5a2432cf203a413305f5ca9d6eb4b2893b374f084c4b26c6b5f5f",
      source: {
        procedural: {
          builder: "grass",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            ax: [
              1,
              0.45
            ],
            blades: [
              11,
              7,
              4
            ],
            colour: "#a9b95e",
            h: [
              0.13,
              0.2
            ],
            lean: [
              0.1,
              0.17
            ],
            seed: 73,
            spread: 0.05,
            w: 0.026
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach"
      ],
      tris: 36
    },
    "model/grass-tuft/lod0": {
      bounds_m: [
        [
          -0.2550515084610881,
          -0.035,
          -0.23340703880022978
        ],
        [
          0.2550515084610881,
          0.26919371430488864,
          0.23340703880022978
        ]
      ],
      bytes: 14688,
      emissive: [],
      file: "c470b7b35c43d14eccf8098ea49c9170819184c74e39859586765850257bd4b7.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/grass-tuft/lod0",
        "model/grass-tuft/lod1",
        "model/grass-tuft/lod2"
      ],
      materials: [
        "grass"
      ],
      nodes: [
        "grass-tuft"
      ],
      note: "grass tuft: chunky V-folded blades (double-sided `grass`)",
      sha256: "c470b7b35c43d14eccf8098ea49c9170819184c74e39859586765850257bd4b7",
      source: {
        procedural: {
          builder: "grass",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            ax: [
              1,
              1
            ],
            blades: [
              13,
              8,
              4
            ],
            colour: "#78bb46",
            h: [
              0.26,
              0.36
            ],
            lean: [
              0.08,
              0.2
            ],
            seed: 71,
            spread: 0.06,
            w: 0.04
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run",
        "gateway-pass",
        "tulip-gardens",
        "ancient-ruins"
      ],
      tris: 378
    },
    "model/grass-tuft/lod1": {
      bounds_m: [
        [
          -0.1545133874730072,
          -0.035,
          -0.17227033182246776
        ],
        [
          0.2550515084610881,
          0.2508403150181957,
          0.23340703880022978
        ]
      ],
      bytes: 5936,
      emissive: [],
      file: "aedb6dc7557f7aa7430aa6b9361d0fdbe6bd685a260f34484ac6b42dcbd46297.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/grass-tuft/lod0",
        "model/grass-tuft/lod1",
        "model/grass-tuft/lod2"
      ],
      materials: [
        "grass"
      ],
      nodes: [
        "grass-tuft"
      ],
      note: "grass tuft: chunky V-folded blades (double-sided `grass`)",
      sha256: "aedb6dc7557f7aa7430aa6b9361d0fdbe6bd685a260f34484ac6b42dcbd46297",
      source: {
        procedural: {
          builder: "grass",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            ax: [
              1,
              1
            ],
            blades: [
              13,
              8,
              4
            ],
            colour: "#78bb46",
            h: [
              0.26,
              0.36
            ],
            lean: [
              0.08,
              0.2
            ],
            seed: 71,
            spread: 0.06,
            w: 0.04
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run",
        "gateway-pass",
        "tulip-gardens",
        "ancient-ruins"
      ],
      tris: 126
    },
    "model/grass-tuft/lod2": {
      bounds_m: [
        [
          -0.09686165366982018,
          -0.035,
          -0.17227033182246776
        ],
        [
          0.2513122920874502,
          0.24265134174776035,
          0.1279371034811742
        ]
      ],
      bytes: 2652,
      emissive: [],
      file: "111f00965e1660f7c455a84d4e83eb04e42889a39629625d85adeefb5beff653.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/grass-tuft/lod0",
        "model/grass-tuft/lod1",
        "model/grass-tuft/lod2"
      ],
      materials: [
        "grass"
      ],
      nodes: [
        "grass-tuft"
      ],
      note: "grass tuft: chunky V-folded blades (double-sided `grass`)",
      sha256: "111f00965e1660f7c455a84d4e83eb04e42889a39629625d85adeefb5beff653",
      source: {
        procedural: {
          builder: "grass",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            ax: [
              1,
              1
            ],
            blades: [
              13,
              8,
              4
            ],
            colour: "#78bb46",
            h: [
              0.26,
              0.36
            ],
            lean: [
              0.08,
              0.2
            ],
            seed: 71,
            spread: 0.06,
            w: 0.04
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run",
        "gateway-pass",
        "tulip-gardens",
        "ancient-ruins"
      ],
      tris: 36
    },
    "model/hangar/lod0": {
      bounds_m: [
        [
          -20.400727717120787,
          0,
          -25.1
        ],
        [
          20.400727717120787,
          20.40061156952348,
          25.799999999999997
        ]
      ],
      bytes: 311076,
      emissive: [],
      file: "b887a558ec2ed25d65d001afa56e78c0288b165579b626dbe280f716bcce9ed5.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/hangar/lod0",
        "model/hangar/lod1",
        "model/hangar/lod2"
      ],
      materials: [
        "roof",
        "wall",
        "door",
        "trim",
        "glass"
      ],
      nodes: [
        "hangar"
      ],
      note: "doors face +Z; roof texture tiles every 4 m (corrugation)",
      sha256: "b887a558ec2ed25d65d001afa56e78c0288b165579b626dbe280f716bcce9ed5",
      source: {
        procedural: {
          builder: "hangar",
          params: {},
          script: "scripts/props.py",
          script_sha256: "36f819f502c05321db5a31b7fb88c7748ace0cfebafba08ad2403f4b8bb2ae57"
        }
      },
      tris: 3982
    },
    "model/hangar/lod1": {
      bounds_m: [
        [
          -20.400601252803757,
          0,
          -25.1
        ],
        [
          20.40060125280376,
          20.40077664749012,
          25.799999999999997
        ]
      ],
      bytes: 67936,
      emissive: [],
      file: "bb2bb1f4f34f0fcb3d8ae3f50f8beeb07913c7327a06c5cb2a8017ec8ad30df7.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/hangar/lod0",
        "model/hangar/lod1",
        "model/hangar/lod2"
      ],
      materials: [
        "roof",
        "wall",
        "door",
        "trim",
        "glass"
      ],
      nodes: [
        "hangar"
      ],
      note: "doors face +Z; roof texture tiles every 4 m (corrugation)",
      sha256: "bb2bb1f4f34f0fcb3d8ae3f50f8beeb07913c7327a06c5cb2a8017ec8ad30df7",
      source: {
        procedural: {
          builder: "hangar",
          params: {},
          script: "scripts/props.py",
          script_sha256: "36f819f502c05321db5a31b7fb88c7748ace0cfebafba08ad2403f4b8bb2ae57"
        }
      },
      tris: 1198
    },
    "model/hangar/lod2": {
      bounds_m: [
        [
          -20,
          0,
          -25
        ],
        [
          20,
          20,
          25.799999999999997
        ]
      ],
      bytes: 11836,
      emissive: [],
      file: "d64d647581f4e4b2f299d78a2a2fa4d65197029fe66103d2370fe2be5b6eab20.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/hangar/lod0",
        "model/hangar/lod1",
        "model/hangar/lod2"
      ],
      materials: [
        "roof",
        "wall",
        "door",
        "trim"
      ],
      nodes: [
        "hangar"
      ],
      note: "doors face +Z; roof texture tiles every 4 m (corrugation)",
      sha256: "d64d647581f4e4b2f299d78a2a2fa4d65197029fe66103d2370fe2be5b6eab20",
      source: {
        procedural: {
          builder: "hangar",
          params: {},
          script: "scripts/props.py",
          script_sha256: "36f819f502c05321db5a31b7fb88c7748ace0cfebafba08ad2403f4b8bb2ae57"
        }
      },
      tris: 156
    },
    "model/hydrant/lod0": {
      bounds_m: [
        [
          -0.13731177151203156,
          0,
          -0.15887178480625153
        ],
        [
          0.13731177151203156,
          0.7994560238003032,
          0.15887178480625153
        ]
      ],
      build: {
        budget: 3e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: [
          "fire_hydrant",
          "fire_hydrant_cap_01",
          "fire_hydrant_cap_02",
          "fire_hydrant_cap_03",
          "fire_hydrant_chain"
        ],
        origin: "bbox"
      },
      bytes: 222208,
      file: "37f9775463961db9df29a32a3c75f91deb417ee24dcc09c75ce659bc59163e90.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/hydrant/lod0",
        "model/hydrant/lod1",
        "model/hydrant/lod2"
      ],
      sha256: "37f9775463961db9df29a32a3c75f91deb417ee24dcc09c75ce659bc59163e90",
      source: {
        polyhaven: {
          id: "fire_hydrant",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/fire_hydrant/fire_hydrant_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 43158
      },
      stages: [
        "metropolis-night"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 512
      },
      tris: 3342
    },
    "model/hydrant/lod1": {
      bounds_m: [
        [
          -0.13731177151203156,
          0,
          -0.15887178480625153
        ],
        [
          0.13731177151203156,
          0.7994560238003032,
          0.15887178480625153
        ]
      ],
      build: {
        budget: 3e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: [
          "fire_hydrant",
          "fire_hydrant_cap_01",
          "fire_hydrant_cap_02",
          "fire_hydrant_cap_03",
          "fire_hydrant_chain"
        ],
        origin: "bbox"
      },
      bytes: 86032,
      file: "e78bddf2c11d1b254bb5bb362a22da9227534883d2f1033ac59d229c6a634aff.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/hydrant/lod0",
        "model/hydrant/lod1",
        "model/hydrant/lod2"
      ],
      sha256: "e78bddf2c11d1b254bb5bb362a22da9227534883d2f1033ac59d229c6a634aff",
      source: {
        polyhaven: {
          id: "fire_hydrant",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/fire_hydrant/fire_hydrant_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 43158
      },
      stages: [
        "metropolis-night"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 256
      },
      tris: 1392
    },
    "model/hydrant/lod2": {
      bounds_m: [
        [
          -0.13731177151203156,
          0,
          -0.15887178480625153
        ],
        [
          0.13731177151203156,
          0.7994560238003032,
          0.15887178480625153
        ]
      ],
      build: {
        budget: 3e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: [
          "fire_hydrant",
          "fire_hydrant_cap_01",
          "fire_hydrant_cap_02",
          "fire_hydrant_cap_03",
          "fire_hydrant_chain"
        ],
        origin: "bbox"
      },
      bytes: 41416,
      file: "f830d2feca80837f8764987559c03e396702ef7030a52892e6a5101c9e34d426.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/hydrant/lod0",
        "model/hydrant/lod1",
        "model/hydrant/lod2"
      ],
      sha256: "f830d2feca80837f8764987559c03e396702ef7030a52892e6a5101c9e34d426",
      source: {
        polyhaven: {
          id: "fire_hydrant",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/fire_hydrant/fire_hydrant_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 43158
      },
      stages: [
        "metropolis-night"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 128
      },
      tris: 1107
    },
    "model/kasbah/lod0": {
      bounds_m: [
        [
          -16.998760682186642,
          -2.0000000000029896,
          -13.998582980467676
        ],
        [
          16.999022568674764,
          28.6,
          13.999957924579688
        ]
      ],
      bytes: 1220756,
      emissive: [],
      file: "3f646c10aca5fa9242e1185d12568bca4a2f032d858457f4bd8685afa0954043.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/kasbah/lod0",
        "model/kasbah/lod1",
        "model/kasbah/lod2"
      ],
      materials: [
        "wall",
        "dark",
        "knoll"
      ],
      nodes: [
        null
      ],
      note: "a mud-brick kasbah on a rock knoll, 29 m: crenellated walls and watchtower; the door at -X, the tower at +X; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "3f646c10aca5fa9242e1185d12568bca4a2f032d858457f4bd8685afa0954043",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "e52650c95b43746dd9f923ee64a683aa3e5aa9ca1c8f58f858fb7ec2ca10fa81.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a mud-brick desert kasbah with crenellated walls and a watchtower, on a red rock knoll",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "kasbah",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 24e3
    },
    "model/kasbah/lod1": {
      bounds_m: [
        [
          -16.995434796804382,
          -2.0000000000000613,
          -13.988767791745836
        ],
        [
          16.996634115471164,
          28.6,
          13.995409111494995
        ]
      ],
      bytes: 419684,
      emissive: [],
      file: "2ed8d3df6b24e19c1871c350cc0867df36352acc9589c0f137948cd04f9e5182.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/kasbah/lod0",
        "model/kasbah/lod1",
        "model/kasbah/lod2"
      ],
      materials: [
        "wall",
        "dark",
        "knoll"
      ],
      nodes: [
        null
      ],
      note: "a mud-brick kasbah on a rock knoll, 29 m: crenellated walls and watchtower; the door at -X, the tower at +X; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "2ed8d3df6b24e19c1871c350cc0867df36352acc9589c0f137948cd04f9e5182",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "36d4729f1d6b6d6efc39a7f93057c4fe1cceb1ea3db229d935aff48003abe7b9.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a mud-brick desert kasbah with crenellated walls and a watchtower, on a red rock knoll",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "kasbah",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 6e3
    },
    "model/kasbah/lod2": {
      bounds_m: [
        [
          -16.97439257357777,
          -2,
          -13.927235824229701
        ],
        [
          16.91638083128996,
          28.5853282029174,
          13.94720032055105
        ]
      ],
      bytes: 142172,
      emissive: [],
      file: "f7c6af6e85e5363a0ebd41e7a79e9299d3644067984b580a444bf1bced63340a.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/kasbah/lod0",
        "model/kasbah/lod1",
        "model/kasbah/lod2"
      ],
      materials: [
        "wall",
        "dark",
        "knoll"
      ],
      nodes: [
        null
      ],
      note: "a mud-brick kasbah on a rock knoll, 29 m: crenellated walls and watchtower; the door at -X, the tower at +X; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "f7c6af6e85e5363a0ebd41e7a79e9299d3644067984b580a444bf1bced63340a",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "54b92913113ab51d9ad95ed467d1236ac80559e0488adf537904671f8ad9b96b.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a mud-brick desert kasbah with crenellated walls and a watchtower, on a red rock knoll",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "kasbah",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 1600
    },
    "model/lighthouse/lod0": {
      bounds_m: [
        [
          -4.2,
          0,
          -4.2
        ],
        [
          4.2,
          25,
          4.2
        ]
      ],
      bytes: 698856,
      emissive: [
        "lamp"
      ],
      file: "37ec5b76918b729208de1ea280161bca1a9d9e941feda96d12a6933f9388bbc6.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/lighthouse/lod0",
        "model/lighthouse/lod1",
        "model/lighthouse/lod2"
      ],
      materials: [
        "stone",
        "paint_white",
        "paint_red",
        "door",
        "trim",
        "iron",
        "glass",
        "lamp"
      ],
      nodes: [
        "lighthouse"
      ],
      note: "lamp centre at y 20.2 m (sphere `lamp` behind `glass`, alpha 0.3)",
      sha256: "37ec5b76918b729208de1ea280161bca1a9d9e941feda96d12a6933f9388bbc6",
      source: {
        procedural: {
          builder: "lighthouse",
          params: {},
          script: "scripts/props.py",
          script_sha256: "36f819f502c05321db5a31b7fb88c7748ace0cfebafba08ad2403f4b8bb2ae57"
        }
      },
      tris: 2348
    },
    "model/lighthouse/lod1": {
      bounds_m: [
        [
          -4.2,
          0,
          -4.2
        ],
        [
          4.2,
          25,
          4.2
        ]
      ],
      bytes: 45648,
      emissive: [
        "lamp"
      ],
      file: "93a2083c0b95d9a41bb386883df083d62a3492a29d7f9920119390a49e0bc373.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/lighthouse/lod0",
        "model/lighthouse/lod1",
        "model/lighthouse/lod2"
      ],
      materials: [
        "stone",
        "paint_white",
        "paint_red",
        "door",
        "trim",
        "iron",
        "glass",
        "lamp"
      ],
      nodes: [
        "lighthouse"
      ],
      note: "lamp centre at y 20.2 m (sphere `lamp` behind `glass`, alpha 0.3)",
      sha256: "93a2083c0b95d9a41bb386883df083d62a3492a29d7f9920119390a49e0bc373",
      source: {
        procedural: {
          builder: "lighthouse",
          params: {},
          script: "scripts/props.py",
          script_sha256: "36f819f502c05321db5a31b7fb88c7748ace0cfebafba08ad2403f4b8bb2ae57"
        }
      },
      tris: 1084
    },
    "model/lighthouse/lod2": {
      bounds_m: [
        [
          -4.2,
          0,
          -4.2
        ],
        [
          4.2,
          25,
          4.2
        ]
      ],
      bytes: 19216,
      emissive: [
        "lamp"
      ],
      file: "dce35fd899482cbf10b19a628dabf784a78b551a33efff80f7b66c83c269275a.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/lighthouse/lod0",
        "model/lighthouse/lod1",
        "model/lighthouse/lod2"
      ],
      materials: [
        "stone",
        "paint_white",
        "paint_red",
        "iron",
        "glass",
        "lamp"
      ],
      nodes: [
        "lighthouse"
      ],
      note: "lamp centre at y 20.2 m (sphere `lamp` behind `glass`, alpha 0.3)",
      sha256: "dce35fd899482cbf10b19a628dabf784a78b551a33efff80f7b66c83c269275a",
      source: {
        procedural: {
          builder: "lighthouse",
          params: {},
          script: "scripts/props.py",
          script_sha256: "36f819f502c05321db5a31b7fb88c7748ace0cfebafba08ad2403f4b8bb2ae57"
        }
      },
      tris: 420
    },
    "model/mesa-a/lod0": {
      bounds_m: [
        [
          -18.939334141871882,
          -2,
          -12.377862097262817
        ],
        [
          18.939334141871882,
          58.8,
          12.377862097262817
        ]
      ],
      bytes: 2316088,
      emissive: [],
      file: "480deb9179c2428fa4bc1803e5f03b2a2355d487e877393a8d6accaca39e586c.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/mesa-a/lod0",
        "model/mesa-a/lod1",
        "model/mesa-a/lod2"
      ],
      materials: [
        "talus",
        "rock_red",
        "caprock"
      ],
      nodes: [
        null
      ],
      note: "three tall painted buttes, 58, 44 and 33 m: lumpy scree aprons to near-vertical faceted walls deeply fluted top to bottom, one warm red rock without horizontal bands, rounded shoulders and domed tops; each butte closed, skirt to y = -2 m, materials talus, rock_red, caprock (no textures); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "480deb9179c2428fa4bc1803e5f03b2a2355d487e877393a8d6accaca39e586c",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "eefa32b3d77153c834ad41ab625d2fc501ffce04794a2ac0fe0f889642d83418.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall red sandstone butte, deeply fluted vertical rock, warm red and orange faces, violet shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "mesa-a",
          params: {},
          script: "props/landforms.py",
          script_sha256: "5fe4b2b262a95c919c0ea061b02ddbfd55be9ed8eeb827558fd2c14ed5437af6"
        }
      },
      tris: 10404
    },
    "model/mesa-a/lod1": {
      bounds_m: [
        [
          -18.772816553927697,
          -2,
          -12.36007578972928
        ],
        [
          18.781094167890046,
          58.80000000000002,
          12.378016015222913
        ]
      ],
      bytes: 870500,
      emissive: [],
      file: "941209ed367097b50f5429791abdb672ecdbd2e073ef36f8a95f08b552d50b05.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/mesa-a/lod0",
        "model/mesa-a/lod1",
        "model/mesa-a/lod2"
      ],
      materials: [
        "talus",
        "rock_red",
        "caprock"
      ],
      nodes: [
        null
      ],
      note: "three tall painted buttes, 58, 44 and 33 m: lumpy scree aprons to near-vertical faceted walls deeply fluted top to bottom, one warm red rock without horizontal bands, rounded shoulders and domed tops; each butte closed, skirt to y = -2 m, materials talus, rock_red, caprock (no textures); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "941209ed367097b50f5429791abdb672ecdbd2e073ef36f8a95f08b552d50b05",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "4ee184b16f9674a696282cce543b0c8227cbb442dacd2b64969810c7bec3eaaf.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall red sandstone butte, deeply fluted vertical rock, warm red and orange faces, violet shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "mesa-a",
          params: {},
          script: "props/landforms.py",
          script_sha256: "5fe4b2b262a95c919c0ea061b02ddbfd55be9ed8eeb827558fd2c14ed5437af6"
        }
      },
      tris: 2550
    },
    "model/mesa-a/lod2": {
      bounds_m: [
        [
          -18.773332922161273,
          -2,
          -12.305646782289914
        ],
        [
          17.152154949220545,
          58.800000000000004,
          12.218734046220161
        ]
      ],
      bytes: 517404,
      emissive: [],
      file: "f2b1906a2a4ce97d9d203b5a63cac8d7deed916f14dfd31f10dd288b3928fa87.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/mesa-a/lod0",
        "model/mesa-a/lod1",
        "model/mesa-a/lod2"
      ],
      materials: [
        "talus",
        "rock_red",
        "caprock"
      ],
      nodes: [
        null
      ],
      note: "three tall painted buttes, 58, 44 and 33 m: lumpy scree aprons to near-vertical faceted walls deeply fluted top to bottom, one warm red rock without horizontal bands, rounded shoulders and domed tops; each butte closed, skirt to y = -2 m, materials talus, rock_red, caprock (no textures); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "f2b1906a2a4ce97d9d203b5a63cac8d7deed916f14dfd31f10dd288b3928fa87",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "df9da23fb4b16f872f983c80e4a3153f01894f2de1b8f9d143a96b4d03260e69.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall red sandstone butte, deeply fluted vertical rock, warm red and orange faces, violet shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "mesa-a",
          params: {},
          script: "props/landforms.py",
          script_sha256: "5fe4b2b262a95c919c0ea061b02ddbfd55be9ed8eeb827558fd2c14ed5437af6"
        }
      },
      tris: 612
    },
    "model/mesa-b/lod0": {
      bounds_m: [
        [
          -20.076876228663494,
          -2,
          -15.548534554267485
        ],
        [
          20.076876228663494,
          46.5,
          15.548534554267485
        ]
      ],
      bytes: 1523200,
      emissive: [],
      file: "1bd59422c3ebb2161d0522da3e73c4b0fb5541eb6199441ce7851c128a41bca0.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/mesa-b/lod0",
        "model/mesa-b/lod1",
        "model/mesa-b/lod2"
      ],
      materials: [
        "talus",
        "rock_red",
        "caprock"
      ],
      nodes: [
        null
      ],
      note: "broad painted mesa, 46 m: two alcoves, a lumpy scree apron to a near-vertical faceted wall deeply fluted top to bottom, one warm red rock without horizontal bands, a rounded shoulder and a gently domed top; each butte closed, skirt to y = -2 m, materials talus, rock_red, caprock (no textures); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "1bd59422c3ebb2161d0522da3e73c4b0fb5541eb6199441ce7851c128a41bca0",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "a761d96fa5ed0b9dd59d05344d8ae94526c8924811e386628caa5eb64a004060.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall red sandstone butte, deeply fluted vertical rock, warm red and orange faces, violet shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "mesa-b",
          params: {},
          script: "props/landforms.py",
          script_sha256: "5fe4b2b262a95c919c0ea061b02ddbfd55be9ed8eeb827558fd2c14ed5437af6"
        }
      },
      tris: 4284
    },
    "model/mesa-b/lod1": {
      bounds_m: [
        [
          -19.962328922206506,
          -2,
          -15.542033605455806
        ],
        [
          19.962979702165473,
          46.49999999999999,
          15.550296715262677
        ]
      ],
      bytes: 677052,
      emissive: [],
      file: "2ee6593dce71a705c2280620b5c20ac05414419ac3adc27e94d6ebe921fa067f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/mesa-b/lod0",
        "model/mesa-b/lod1",
        "model/mesa-b/lod2"
      ],
      materials: [
        "talus",
        "rock_red",
        "caprock"
      ],
      nodes: [
        null
      ],
      note: "broad painted mesa, 46 m: two alcoves, a lumpy scree apron to a near-vertical faceted wall deeply fluted top to bottom, one warm red rock without horizontal bands, a rounded shoulder and a gently domed top; each butte closed, skirt to y = -2 m, materials talus, rock_red, caprock (no textures); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "2ee6593dce71a705c2280620b5c20ac05414419ac3adc27e94d6ebe921fa067f",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "b5e6c43696e7f818185440a3f382606a36269f26aab862b3c9af57a7545645b5.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall red sandstone butte, deeply fluted vertical rock, warm red and orange faces, violet shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "mesa-b",
          params: {},
          script: "props/landforms.py",
          script_sha256: "5fe4b2b262a95c919c0ea061b02ddbfd55be9ed8eeb827558fd2c14ed5437af6"
        }
      },
      tris: 1050
    },
    "model/mesa-b/lod2": {
      bounds_m: [
        [
          -19.778380703897792,
          -2,
          -15.314887419088953
        ],
        [
          18.04482870602227,
          46.5,
          15.442335867490064
        ]
      ],
      bytes: 467380,
      emissive: [],
      file: "fad79adf1aed86bf185719405b66b7b590f3e5bd8bfb2dce29be9cd9461b5435.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/mesa-b/lod0",
        "model/mesa-b/lod1",
        "model/mesa-b/lod2"
      ],
      materials: [
        "talus",
        "rock_red",
        "caprock"
      ],
      nodes: [
        null
      ],
      note: "broad painted mesa, 46 m: two alcoves, a lumpy scree apron to a near-vertical faceted wall deeply fluted top to bottom, one warm red rock without horizontal bands, a rounded shoulder and a gently domed top; each butte closed, skirt to y = -2 m, materials talus, rock_red, caprock (no textures); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "fad79adf1aed86bf185719405b66b7b590f3e5bd8bfb2dce29be9cd9461b5435",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "5fdc970ef6c9c30e0fe7210d0dfa5191004b5321fa821e0d6ed87dbc892f04aa.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall red sandstone butte, deeply fluted vertical rock, warm red and orange faces, violet shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "6f81b658e4a51cda8d11b0e34667588e0f347011ee11473843fe8a7002d139ff",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "mesa-b",
          params: {},
          script: "props/landforms.py",
          script_sha256: "5fe4b2b262a95c919c0ea061b02ddbfd55be9ed8eeb827558fd2c14ed5437af6"
        }
      },
      tris: 252
    },
    "model/palm-a/lod0": {
      bounds_m: [
        [
          -4.01318921725805,
          -0.09089414170756319,
          -3.9664385149309482
        ],
        [
          5.966535245696642,
          14.433275005807602,
          5.592648294599079
        ]
      ],
      bytes: 2222376,
      emissive: [],
      file: "6e9e734a196aa0604661763f18db1d79f1e46ad7c1db35d39224260da34bd529.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/palm-a/lod0",
        "model/palm-a/lod1",
        "model/palm-a/lod2"
      ],
      materials: [
        "bark",
        "frond",
        "frond_dry",
        "coconut"
      ],
      nodes: [
        "palm-a"
      ],
      note: "coconut palm (palm.py's trunk curve: height 13.0 m, lean 1.6 m, bow 0.7 m); origin at the trunk foot; double-sided `frond` / `frond_dry` (LOD2: 8 fronds, no coconuts or dry fronds); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "6e9e734a196aa0604661763f18db1d79f1e46ad7c1db35d39224260da34bd529",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "a5c7dfc4a58c1a229f4b0b2cff6462d49c93016f068413c75e7de287fe231140.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall slender coconut palm tree, curved ringed trunk, crown of drooping green fronds",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "palm",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            bow: 0.7,
            dead: 2,
            fronds: 13,
            height: 13,
            lean: 1.6,
            nuts: 4,
            seed: 11
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach",
        "destination-marina",
        "destination-oasis"
      ],
      tris: 11922
    },
    "model/palm-a/lod1": {
      bounds_m: [
        [
          -4.137893388716412,
          -0.09351038347405029,
          -4.0735033463325365
        ],
        [
          6.103942371062303,
          14.428712399762881,
          5.718427089286362
        ]
      ],
      bytes: 662248,
      emissive: [],
      file: "653bebcedc0d86a04b161b9f7d0ee322f130943a04816f4fbf0a08fe665c6704.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/palm-a/lod0",
        "model/palm-a/lod1",
        "model/palm-a/lod2"
      ],
      materials: [
        "bark",
        "frond",
        "frond_dry",
        "coconut"
      ],
      nodes: [
        "palm-a"
      ],
      note: "coconut palm (palm.py's trunk curve: height 13.0 m, lean 1.6 m, bow 0.7 m); origin at the trunk foot; double-sided `frond` / `frond_dry` (LOD2: 8 fronds, no coconuts or dry fronds); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "653bebcedc0d86a04b161b9f7d0ee322f130943a04816f4fbf0a08fe665c6704",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "4c634716aafec3c344a89755ff70a4236f12e91047d04fae330b38db4c7e7a13.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall slender coconut palm tree, curved ringed trunk, crown of drooping green fronds",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "palm",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            bow: 0.7,
            dead: 2,
            fronds: 13,
            height: 13,
            lean: 1.6,
            nuts: 4,
            seed: 11
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach",
        "destination-marina",
        "destination-oasis"
      ],
      tris: 3038
    },
    "model/palm-a/lod2": {
      bounds_m: [
        [
          -4.0098747414072955,
          -0.10068528960027867,
          -3.9605042116735345
        ],
        [
          5.653954743893617,
          14.23585997399628,
          5.5732656249600705
        ]
      ],
      bytes: 125016,
      emissive: [],
      file: "d071e4977ce7d9a205e9f5cb5ed70eb92cfe12688ef06b9b44bbea86b3ef42a1.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/palm-a/lod0",
        "model/palm-a/lod1",
        "model/palm-a/lod2"
      ],
      materials: [
        "bark",
        "frond"
      ],
      nodes: [
        "palm-a"
      ],
      note: "coconut palm (palm.py's trunk curve: height 13.0 m, lean 1.6 m, bow 0.7 m); origin at the trunk foot; double-sided `frond` / `frond_dry` (LOD2: 8 fronds, no coconuts or dry fronds); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "d071e4977ce7d9a205e9f5cb5ed70eb92cfe12688ef06b9b44bbea86b3ef42a1",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "2874ab5540ff4d09c96cc02688729730107713fbadaf1cdbb5973da070cd5596.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall slender coconut palm tree, curved ringed trunk, crown of drooping green fronds",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "palm",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            bow: 0.7,
            dead: 2,
            fronds: 13,
            height: 13,
            lean: 1.6,
            nuts: 4,
            seed: 11
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach",
        "destination-marina",
        "destination-oasis"
      ],
      tris: 280
    },
    "model/palm-b/lod0": {
      bounds_m: [
        [
          -5.857213670491403,
          -0.09502093908068888,
          -6.982114287834151
        ],
        [
          3.8271290156385867,
          16.36509564170966,
          2.38761727030227
        ]
      ],
      bytes: 2173252,
      emissive: [],
      file: "c7848135ada466bdb5ee475ae6a9bff028f98906bddf26cde5ad0133fb4e712f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/palm-b/lod0",
        "model/palm-b/lod1",
        "model/palm-b/lod2"
      ],
      materials: [
        "bark",
        "frond",
        "frond_dry",
        "coconut"
      ],
      nodes: [
        "palm-b"
      ],
      note: "coconut palm (palm.py's trunk curve: height 15.0 m, lean 2.4 m, bow 1.1 m); origin at the trunk foot; double-sided `frond` / `frond_dry` (LOD2: 8 fronds, no coconuts or dry fronds); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "c7848135ada466bdb5ee475ae6a9bff028f98906bddf26cde5ad0133fb4e712f",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "945b5534b83be38970a435e464245bad97ad927c85f32271e09ae3d680266ba4.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall slender coconut palm tree, curved ringed trunk, crown of drooping green fronds",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "palm",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            bow: 1.1,
            dead: 2,
            fronds: 12,
            height: 15,
            lean: 2.4,
            nuts: 3,
            seed: 23
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach",
        "destination-marina",
        "destination-oasis"
      ],
      tris: 11300
    },
    "model/palm-b/lod1": {
      bounds_m: [
        [
          -5.984147943463413,
          -0.09716193669459117,
          -7.1008648520516555
        ],
        [
          3.9407223411450363,
          16.361586003576665,
          2.5512794401105796
        ]
      ],
      bytes: 647460,
      emissive: [],
      file: "44f4f698179551aa8036aa24de43332624674f81fd3d8b43cd716b8dca8aa4cf.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/palm-b/lod0",
        "model/palm-b/lod1",
        "model/palm-b/lod2"
      ],
      materials: [
        "bark",
        "frond",
        "frond_dry",
        "coconut"
      ],
      nodes: [
        "palm-b"
      ],
      note: "coconut palm (palm.py's trunk curve: height 15.0 m, lean 2.4 m, bow 1.1 m); origin at the trunk foot; double-sided `frond` / `frond_dry` (LOD2: 8 fronds, no coconuts or dry fronds); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "44f4f698179551aa8036aa24de43332624674f81fd3d8b43cd716b8dca8aa4cf",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "8cf67582e3dc2ef88670b80febabf718ded9dad8e592cc5ce3f8e8696dfd1fbc.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall slender coconut palm tree, curved ringed trunk, crown of drooping green fronds",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "palm",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            bow: 1.1,
            dead: 2,
            fronds: 12,
            height: 15,
            lean: 2.4,
            nuts: 3,
            seed: 23
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach",
        "destination-marina",
        "destination-oasis"
      ],
      tris: 2886
    },
    "model/palm-b/lod2": {
      bounds_m: [
        [
          -5.852926111967071,
          -0.11020442019418117,
          -6.978016482203677
        ],
        [
          3.822269273245552,
          16.20321137139298,
          2.3437972645503393
        ]
      ],
      bytes: 120316,
      emissive: [],
      file: "1e59a29d5739b74cefb78a2aa9565b2a6ec5451a26208537bd7cc5a0956e1b54.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/palm-b/lod0",
        "model/palm-b/lod1",
        "model/palm-b/lod2"
      ],
      materials: [
        "bark",
        "frond"
      ],
      nodes: [
        "palm-b"
      ],
      note: "coconut palm (palm.py's trunk curve: height 15.0 m, lean 2.4 m, bow 1.1 m); origin at the trunk foot; double-sided `frond` / `frond_dry` (LOD2: 8 fronds, no coconuts or dry fronds); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "1e59a29d5739b74cefb78a2aa9565b2a6ec5451a26208537bd7cc5a0956e1b54",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "4f0361a55beb8b2d2589965e9ea2d3d1c76564f3da839495b3c931517fac02c1.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall slender coconut palm tree, curved ringed trunk, crown of drooping green fronds",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "palm",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            bow: 1.1,
            dead: 2,
            fronds: 12,
            height: 15,
            lean: 2.4,
            nuts: 3,
            seed: 23
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach",
        "destination-marina",
        "destination-oasis"
      ],
      tris: 280
    },
    "model/palm-c/lod0": {
      bounds_m: [
        [
          -4.8362843934954,
          -0.087332780911422,
          -5.677682467331793
        ],
        [
          4.817486046097131,
          12.432682530181635,
          3.798580191761335
        ]
      ],
      bytes: 2255384,
      emissive: [],
      file: "016880dc91da0e96f920651ea908062866d8447c88cb2403577349e0edf98684.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/palm-c/lod0",
        "model/palm-c/lod1",
        "model/palm-c/lod2"
      ],
      materials: [
        "bark",
        "frond",
        "frond_dry",
        "coconut"
      ],
      nodes: [
        "palm-c"
      ],
      note: "coconut palm (palm.py's trunk curve: height 11.0 m, lean 0.9 m, bow 0.4 m); origin at the trunk foot; double-sided `frond` / `frond_dry` (LOD2: 8 fronds, no coconuts or dry fronds); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "016880dc91da0e96f920651ea908062866d8447c88cb2403577349e0edf98684",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "c072bbff5e380d4b3f63c5749ea7edc5ff0084959e95d44d43a580b89de75642.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall slender coconut palm tree, curved ringed trunk, crown of drooping green fronds",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "palm",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            bow: 0.4,
            dead: 2,
            fronds: 13,
            height: 11,
            lean: 0.9,
            nuts: 5,
            seed: 37
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach",
        "destination-marina",
        "destination-oasis"
      ],
      tris: 12022
    },
    "model/palm-c/lod1": {
      bounds_m: [
        [
          -4.983569784930544,
          -0.08870240429489121,
          -5.798004154936056
        ],
        [
          4.958255592207656,
          12.420399376270725,
          3.9340612855728945
        ]
      ],
      bytes: 667504,
      emissive: [],
      file: "bd5ee449dc2274990ae373b919c3b5fa795ba85ede84e93d0d943ace6a873579.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/palm-c/lod0",
        "model/palm-c/lod1",
        "model/palm-c/lod2"
      ],
      materials: [
        "bark",
        "frond",
        "frond_dry",
        "coconut"
      ],
      nodes: [
        "palm-c"
      ],
      note: "coconut palm (palm.py's trunk curve: height 11.0 m, lean 0.9 m, bow 0.4 m); origin at the trunk foot; double-sided `frond` / `frond_dry` (LOD2: 8 fronds, no coconuts or dry fronds); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "bd5ee449dc2274990ae373b919c3b5fa795ba85ede84e93d0d943ace6a873579",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "f649aa4f06370708ecc5af68bd864fcd555a471e6df6b11dd71d38951eef8055.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall slender coconut palm tree, curved ringed trunk, crown of drooping green fronds",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "palm",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            bow: 0.4,
            dead: 2,
            fronds: 13,
            height: 11,
            lean: 0.9,
            nuts: 5,
            seed: 37
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach",
        "destination-marina",
        "destination-oasis"
      ],
      tris: 3038
    },
    "model/palm-c/lod2": {
      bounds_m: [
        [
          -4.772390499829271,
          -0.09484894550033904,
          -5.6734665007666765
        ],
        [
          4.815088111873445,
          12.252517882140234,
          3.7958741795152635
        ]
      ],
      bytes: 126868,
      emissive: [],
      file: "12eb197705651b5cc54a6f68baf3b49483bacf2f6b37154203990db7463e32b7.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/palm-c/lod0",
        "model/palm-c/lod1",
        "model/palm-c/lod2"
      ],
      materials: [
        "bark",
        "frond"
      ],
      nodes: [
        "palm-c"
      ],
      note: "coconut palm (palm.py's trunk curve: height 11.0 m, lean 0.9 m, bow 0.4 m); origin at the trunk foot; double-sided `frond` / `frond_dry` (LOD2: 8 fronds, no coconuts or dry fronds); painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "12eb197705651b5cc54a6f68baf3b49483bacf2f6b37154203990db7463e32b7",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "c4f778f7fc926d1ea2bafe04b6f0004b6225e5c649d3e8bc3a516ba668a33c93.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall slender coconut palm tree, curved ringed trunk, crown of drooping green fronds",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "palm",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            bow: 0.4,
            dead: 2,
            fronds: 13,
            height: 11,
            lean: 0.9,
            nuts: 5,
            seed: 37
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach",
        "destination-marina",
        "destination-oasis"
      ],
      tris: 280
    },
    "model/power-pole/lod0": {
      bounds_m: [
        [
          -0.6158170646168091,
          0,
          -0.18408178271394252
        ],
        [
          0.6157531933693386,
          7.223,
          0.18420553093315412
        ]
      ],
      bytes: 68936,
      emissive: [],
      file: "d27f13c2a33d13aab55c7bffb45f4259dcda95dc6edfd586a197455267bbc33f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/power-pole/lod0",
        "model/power-pole/lod1",
        "model/power-pole/lod2"
      ],
      materials: [
        "wood",
        "metal",
        "glass"
      ],
      nodes: [
        "power-pole"
      ],
      note: "wooden utility pole, 7.2 m: tapered round pole with a domed top, a crossarm across +-x on the pole's +z face, two steel braces, three glass pin insulators (two on the arm, one on the pole top); separate closed shells per piece; materials wood, metal, glass; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "d27f13c2a33d13aab55c7bffb45f4259dcda95dc6edfd586a197455267bbc33f",
      source: {
        procedural: {
          builder: "power_pole",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/props.py",
          script_sha256: "0401b56caf40ace7f76cc450c7184193146b42aa9c7b3fc73c94b22159c3bc17"
        }
      },
      stages: [
        "sunset-highway",
        "metropolis-night"
      ],
      tris: 2686,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/power-pole/lod1": {
      bounds_m: [
        [
          -0.6157648328241413,
          0,
          -0.18407207806606884
        ],
        [
          0.6194890466727878,
          7.223,
          0.18104053139358084
        ]
      ],
      bytes: 22276,
      emissive: [],
      file: "1d67ac725cb8c7432fae447336514e0c2a2f79e7406081e416320f3cc3afe6e8.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/power-pole/lod0",
        "model/power-pole/lod1",
        "model/power-pole/lod2"
      ],
      materials: [
        "wood",
        "metal",
        "glass"
      ],
      nodes: [
        "power-pole"
      ],
      note: "wooden utility pole, 7.2 m: tapered round pole with a domed top, a crossarm across +-x on the pole's +z face, two steel braces, three glass pin insulators (two on the arm, one on the pole top); separate closed shells per piece; materials wood, metal, glass; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "1d67ac725cb8c7432fae447336514e0c2a2f79e7406081e416320f3cc3afe6e8",
      source: {
        procedural: {
          builder: "power_pole",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/props.py",
          script_sha256: "0401b56caf40ace7f76cc450c7184193146b42aa9c7b3fc73c94b22159c3bc17"
        }
      },
      stages: [
        "sunset-highway",
        "metropolis-night"
      ],
      tris: 760,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/power-pole/lod2": {
      bounds_m: [
        [
          -0.6157648328241413,
          0,
          -0.1806346382417952
        ],
        [
          0.620683358675106,
          7.223,
          0.17745357541251627
        ]
      ],
      bytes: 8988,
      emissive: [],
      file: "92c5c65f9a329726f06caadf775a164bd7bf82117d977d6445afac8b75208c58.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/power-pole/lod0",
        "model/power-pole/lod1",
        "model/power-pole/lod2"
      ],
      materials: [
        "wood",
        "metal",
        "glass"
      ],
      nodes: [
        "power-pole"
      ],
      note: "wooden utility pole, 7.2 m: tapered round pole with a domed top, a crossarm across +-x on the pole's +z face, two steel braces, three glass pin insulators (two on the arm, one on the pole top); separate closed shells per piece; materials wood, metal, glass; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "92c5c65f9a329726f06caadf775a164bd7bf82117d977d6445afac8b75208c58",
      source: {
        procedural: {
          builder: "power_pole",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/props.py",
          script_sha256: "0401b56caf40ace7f76cc450c7184193146b42aa9c7b3fc73c94b22159c3bc17"
        }
      },
      stages: [
        "sunset-highway",
        "metropolis-night"
      ],
      tris: 218,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/riders/lod0": {
      bounds_m: [
        [
          -0.8644402033695628,
          0.47011027180942894,
          -1.2711708507278776
        ],
        [
          0.5908657563594423,
          1.4236339266510396,
          33802527804782656e-20
        ]
      ],
      bytes: 862940,
      file: "6fbfad59a2ee803994e86ba3edaa071c5be8e9dcd6bc47fb60aa65b925823abb.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/riders/lod0",
        "model/riders/lod1"
      ],
      materials: [
        "skin",
        "cheek",
        "eye",
        "hair",
        "hairB",
        "dress",
        "collar",
        "ribbon",
        "jacket",
        "trim",
        "trousers",
        "scarf",
        "wheel"
      ],
      nodes: [
        "girl",
        "girl_hair",
        "girl_ribbon",
        "boy",
        "boy_scarf",
        "boy_wave",
        "boy_rest",
        "boy_head"
      ],
      note: "the hero car's two Ghibli riders: the girl driving from the left seat (auburn bob and long locks, red ribbon, yellow dress with a round white collar, both hands on the wheel) and the boy riding beside her (messy dark hair, blue jacket with a turned-up collar, red neckerchief, his outer arm on the door, waving at a moment); big low-set eyes, brows, a button nose, a small mouth, rosy cheeks",
      rig: {
        driver: "girl",
        flutter: "each node with flutter_axis turns about that local axis by up to flutter_rad, about its origin (the pivot)",
        frame: "the car's glTF frame (Y up, metres, nose on +Z): parent the root nodes to the car's chassis",
        nodes: {
          boy: {
            figure: "boy",
            flutter_axis: null,
            flutter_rad: 0,
            pivot_m: [
              -0.36,
              0.5,
              -0.74
            ]
          },
          boy_head: {
            figure: "boy",
            flutter_axis: null,
            flutter_rad: 0,
            pivot_m: [
              -0.36,
              1,
              -0.732
            ]
          },
          boy_rest: {
            figure: "boy",
            flutter_axis: null,
            flutter_rad: 0,
            pivot_m: [
              -0.525,
              0.89,
              -0.75
            ]
          },
          boy_scarf: {
            figure: "boy",
            flutter_axis: "x",
            flutter_rad: 0.35,
            pivot_m: [
              -0.33999999999999997,
              0.9299999999999999,
              -0.69
            ]
          },
          boy_wave: {
            figure: "boy",
            flutter_axis: null,
            flutter_rad: 0,
            pivot_m: [
              -0.525,
              0.89,
              -0.75
            ]
          },
          girl: {
            figure: "girl",
            flutter_axis: null,
            flutter_rad: 0,
            pivot_m: [
              0.36,
              0.5,
              -0.74
            ]
          },
          girl_hair: {
            figure: "girl",
            flutter_axis: "x",
            flutter_rad: 0.22,
            pivot_m: [
              0.36,
              1.1,
              -0.84
            ]
          },
          girl_ribbon: {
            figure: "girl",
            flutter_axis: "x",
            flutter_rad: 0.4,
            pivot_m: [
              0.36,
              1.2349999999999999,
              -0.84
            ]
          }
        },
        seats_m: {
          boy: [
            -0.36,
            0.5,
            -0.74
          ],
          girl: [
            0.36,
            0.5,
            -0.74
          ]
        }
      },
      sha256: "6fbfad59a2ee803994e86ba3edaa071c5be8e9dcd6bc47fb60aa65b925823abb",
      source: {
        procedural: {
          script: "cartoon/riders/build.py",
          scripts_sha256: {
            "cartoon/flagman/figure.py": "dab8812c4638a0668dbe249afcb8598723ea78b09cf29d85c29d299847b7eb36",
            "cartoon/flagman/gltf_io.py": "1d92366fb7fff282c3515533bc22cff4fdf8b872f14b01fff026abd8ad9812a6",
            "cartoon/flagman/mats.py": "17091392852cb4cde7a1ff7a14c4b93925d37886ce97bf3c14dc527d9ebce700",
            "cartoon/flagman/toon.py": "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9",
            "cartoon/riders/build.py": "aedcac2e72422d69e6bb43cfb31e9424319dac721dcec6ec7f9976a4aac2deb0",
            "cartoon/riders/figures.py": "8844017d41abd3d3dde68de5100246c830bce8ab120776ceed0bd5ee27794c07",
            "cartoon/riders/pack.py": "decb5b5406126f883023c4129523ac553019c05e6156da87cc56f0f6196dc24c"
          }
        }
      },
      tris: 33620,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion, a multiplier of baseColor"
    },
    "model/riders/lod1": {
      bounds_m: [
        [
          -0.8644733236660411,
          0.4700698071632461,
          -1.2718843818053696
        ],
        [
          0.5906356746176286,
          1.4206126104619377,
          0.001095736545517978
        ]
      ],
      bytes: 270812,
      file: "28a76145c918d64791b8a9807c5a4b88386e34bcc1944593c5c2159c03badaff.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/riders/lod0",
        "model/riders/lod1"
      ],
      materials: [
        "skin",
        "cheek",
        "eye",
        "hair",
        "hairB",
        "dress",
        "collar",
        "ribbon",
        "jacket",
        "trim",
        "trousers",
        "scarf",
        "wheel"
      ],
      nodes: [
        "girl",
        "girl_hair",
        "girl_ribbon",
        "boy",
        "boy_scarf",
        "boy_wave",
        "boy_rest",
        "boy_head"
      ],
      note: "the hero car's two Ghibli riders: the girl driving from the left seat (auburn bob and long locks, red ribbon, yellow dress with a round white collar, both hands on the wheel) and the boy riding beside her (messy dark hair, blue jacket with a turned-up collar, red neckerchief, his outer arm on the door, waving at a moment); big low-set eyes, brows, a button nose, a small mouth, rosy cheeks",
      rig: {
        driver: "girl",
        flutter: "each node with flutter_axis turns about that local axis by up to flutter_rad, about its origin (the pivot)",
        frame: "the car's glTF frame (Y up, metres, nose on +Z): parent the root nodes to the car's chassis",
        nodes: {
          boy: {
            figure: "boy",
            flutter_axis: null,
            flutter_rad: 0,
            pivot_m: [
              -0.36,
              0.5,
              -0.74
            ]
          },
          boy_head: {
            figure: "boy",
            flutter_axis: null,
            flutter_rad: 0,
            pivot_m: [
              -0.36,
              1,
              -0.732
            ]
          },
          boy_rest: {
            figure: "boy",
            flutter_axis: null,
            flutter_rad: 0,
            pivot_m: [
              -0.525,
              0.89,
              -0.75
            ]
          },
          boy_scarf: {
            figure: "boy",
            flutter_axis: "x",
            flutter_rad: 0.35,
            pivot_m: [
              -0.33999999999999997,
              0.9299999999999999,
              -0.69
            ]
          },
          boy_wave: {
            figure: "boy",
            flutter_axis: null,
            flutter_rad: 0,
            pivot_m: [
              -0.525,
              0.89,
              -0.75
            ]
          },
          girl: {
            figure: "girl",
            flutter_axis: null,
            flutter_rad: 0,
            pivot_m: [
              0.36,
              0.5,
              -0.74
            ]
          },
          girl_hair: {
            figure: "girl",
            flutter_axis: "x",
            flutter_rad: 0.22,
            pivot_m: [
              0.36,
              1.1,
              -0.84
            ]
          },
          girl_ribbon: {
            figure: "girl",
            flutter_axis: "x",
            flutter_rad: 0.4,
            pivot_m: [
              0.36,
              1.2349999999999999,
              -0.84
            ]
          }
        },
        seats_m: {
          boy: [
            -0.36,
            0.5,
            -0.74
          ],
          girl: [
            0.36,
            0.5,
            -0.74
          ]
        }
      },
      sha256: "28a76145c918d64791b8a9807c5a4b88386e34bcc1944593c5c2159c03badaff",
      source: {
        procedural: {
          script: "cartoon/riders/build.py",
          scripts_sha256: {
            "cartoon/flagman/figure.py": "dab8812c4638a0668dbe249afcb8598723ea78b09cf29d85c29d299847b7eb36",
            "cartoon/flagman/gltf_io.py": "1d92366fb7fff282c3515533bc22cff4fdf8b872f14b01fff026abd8ad9812a6",
            "cartoon/flagman/mats.py": "17091392852cb4cde7a1ff7a14c4b93925d37886ce97bf3c14dc527d9ebce700",
            "cartoon/flagman/toon.py": "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9",
            "cartoon/riders/build.py": "aedcac2e72422d69e6bb43cfb31e9424319dac721dcec6ec7f9976a4aac2deb0",
            "cartoon/riders/figures.py": "8844017d41abd3d3dde68de5100246c830bce8ab120776ceed0bd5ee27794c07",
            "cartoon/riders/pack.py": "decb5b5406126f883023c4129523ac553019c05e6156da87cc56f0f6196dc24c"
          }
        }
      },
      tris: 9474,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion, a multiplier of baseColor"
    },
    "model/rock-a/lod0": {
      bounds_m: [
        [
          -0.10458588841301149,
          0,
          -0.17697968124285493
        ],
        [
          0.10466441174871939,
          0.1612596977760259,
          0.17716317220745534
        ]
      ],
      bytes: 68192,
      emissive: [],
      file: "7589a3372f5e3ec85e4dbd90e9cb7b534f85c76f8e6944f90297f260704673ba.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-a/lod0",
        "model/rock-a/lod1",
        "model/rock-a/lod2"
      ],
      materials: [
        "stone"
      ],
      nodes: [
        "rock-a"
      ],
      note: "stone block, 0.15 m (scaled in game): a loaf of large planar facets, rounded edges, a flat top and a chipped corner; material stone (warm grey limestone); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "7589a3372f5e3ec85e4dbd90e9cb7b534f85c76f8e6944f90297f260704673ba",
      source: {
        procedural: {
          builder: "rock_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "gateway-pass",
        "sunset-highway",
        "ancient-ruins"
      ],
      tris: 2660,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-a/lod1": {
      bounds_m: [
        [
          -0.10439599796888158,
          0,
          -0.17684546479519145
        ],
        [
          0.10455885591484049,
          0.16121858236556746,
          0.1771784389007948
        ]
      ],
      bytes: 20832,
      emissive: [],
      file: "d20369518407cbf3e514beed24d2be0c7d5a5cc7f8140744578ebb2f7dc3db02.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-a/lod0",
        "model/rock-a/lod1",
        "model/rock-a/lod2"
      ],
      materials: [
        "stone"
      ],
      nodes: [
        "rock-a"
      ],
      note: "stone block, 0.15 m (scaled in game): a loaf of large planar facets, rounded edges, a flat top and a chipped corner; material stone (warm grey limestone); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "d20369518407cbf3e514beed24d2be0c7d5a5cc7f8140744578ebb2f7dc3db02",
      source: {
        procedural: {
          builder: "rock_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "gateway-pass",
        "sunset-highway",
        "ancient-ruins"
      ],
      tris: 744,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-a/lod2": {
      bounds_m: [
        [
          -0.10413722239419891,
          0,
          -0.17708594676614992
        ],
        [
          0.10463253490295579,
          0.16123386939520654,
          0.1770193630650412
        ]
      ],
      bytes: 6324,
      emissive: [],
      file: "3c18b82a0804f8f77625fa0b8f913a67349c4eaaeb2c448ca29c7cae62c73253.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-a/lod0",
        "model/rock-a/lod1",
        "model/rock-a/lod2"
      ],
      materials: [
        "stone"
      ],
      nodes: [
        "rock-a"
      ],
      note: "stone block, 0.15 m (scaled in game): a loaf of large planar facets, rounded edges, a flat top and a chipped corner; material stone (warm grey limestone); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "3c18b82a0804f8f77625fa0b8f913a67349c4eaaeb2c448ca29c7cae62c73253",
      source: {
        procedural: {
          builder: "rock_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "gateway-pass",
        "sunset-highway",
        "ancient-ruins"
      ],
      tris: 186,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-arch/lod0": {
      bounds_m: [
        [
          -34.22669125157185,
          -2.0000016922881207,
          -10.949092562837718
        ],
        [
          30.72757912011943,
          40.89504549185924,
          10.967310954330244
        ]
      ],
      bytes: 1521344,
      emissive: [],
      file: "0cbdb1fe11152ec2c7a0ab896ec6887fa09c237ebc76984b4c549c8bd122bf79.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-arch/lod0",
        "model/rock-arch/lod1",
        "model/rock-arch/lod2"
      ],
      materials: [
        "talus",
        "rock_red"
      ],
      nodes: [
        null
      ],
      note: "the desert's great rock arch, 41 m: a thin, uneven red sandstone span from a tall fluted butte to a lower one, scree at their feet; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "0cbdb1fe11152ec2c7a0ab896ec6887fa09c237ebc76984b4c549c8bd122bf79",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "c4acc91af4e4e134d6b5865cc876b4a787efadf4bf2fa43123a008b47dd068e8.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a great natural red sandstone rock arch between two fluted buttes, warm red and orange faces, violet shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "rock-arch",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 24e3
    },
    "model/rock-arch/lod1": {
      bounds_m: [
        [
          -34.20029708144306,
          -2,
          -10.917435719983697
        ],
        [
          30.688220497067714,
          40.887097115041854,
          10.973013576669667
        ]
      ],
      bytes: 487484,
      emissive: [],
      file: "142632f5cc6025da45331c3fbddb80a6bd83c6c62c26f00f6f56bd58903d1f90.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-arch/lod0",
        "model/rock-arch/lod1",
        "model/rock-arch/lod2"
      ],
      materials: [
        "talus",
        "rock_red"
      ],
      nodes: [
        null
      ],
      note: "the desert's great rock arch, 41 m: a thin, uneven red sandstone span from a tall fluted butte to a lower one, scree at their feet; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "142632f5cc6025da45331c3fbddb80a6bd83c6c62c26f00f6f56bd58903d1f90",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "45082c5647f5f51646358a123aac1a12975119e213abead4ab7d7f5b1ceaefe8.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a great natural red sandstone rock arch between two fluted buttes, warm red and orange faces, violet shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "rock-arch",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 6e3
    },
    "model/rock-arch/lod2": {
      bounds_m: [
        [
          -34.14860918827937,
          -2.0000000020084534,
          -10.88580265783621
        ],
        [
          30.752078561777477,
          40.77293468607108,
          10.91628351252556
        ]
      ],
      bytes: 156148,
      emissive: [],
      file: "5e164ed6121a6b89115d3ab62ed3a91e04e8457e60e1f63f0a327332432d5068.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-arch/lod0",
        "model/rock-arch/lod1",
        "model/rock-arch/lod2"
      ],
      materials: [
        "talus",
        "rock_red"
      ],
      nodes: [
        null
      ],
      note: "the desert's great rock arch, 41 m: a thin, uneven red sandstone span from a tall fluted butte to a lower one, scree at their feet; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "5e164ed6121a6b89115d3ab62ed3a91e04e8457e60e1f63f0a327332432d5068",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "589ffc3e7b71e6ea0d3ee053b691e41f544ca473dcde5d594fb66aa955b08498.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a great natural red sandstone rock arch between two fluted buttes, warm red and orange faces, violet shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "rock-arch",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 1600
    },
    "model/rock-b/lod0": {
      bounds_m: [
        [
          -0.04044588365852902,
          0,
          -0.06694876477104737
        ],
        [
          0.0404983340434326,
          0.035095827558315605,
          0.06647777914830386
        ]
      ],
      bytes: 54376,
      emissive: [],
      file: "40ac2782164a0342c65634acae9182572f14414b000e061bce6b3361dc5f33c2.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-b/lod0",
        "model/rock-b/lod1",
        "model/rock-b/lod2"
      ],
      materials: [
        "stone"
      ],
      nodes: [
        "rock-b"
      ],
      note: "flat slab, 33 mm (scaled in game): a six-sided plate with near-vertical planar sides, chamfered and rounded edges, a smaller plate lying on one end so a ledge steps across the top; material stone (grey-brown); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "40ac2782164a0342c65634acae9182572f14414b000e061bce6b3361dc5f33c2",
      source: {
        procedural: {
          builder: "rock_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "gateway-pass",
        "sunset-highway",
        "ancient-ruins"
      ],
      tris: 2024,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-b/lod1": {
      bounds_m: [
        [
          -0.04052770499731057,
          0,
          -0.06678155685411921
        ],
        [
          0.04057983526701071,
          0.035095827558315605,
          0.06668279703920942
        ]
      ],
      bytes: 17632,
      emissive: [],
      file: "7b35e21d4323ed811f91ed6d8d845b02dded6d3ebc2734697408d4c63a73659f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-b/lod0",
        "model/rock-b/lod1",
        "model/rock-b/lod2"
      ],
      materials: [
        "stone"
      ],
      nodes: [
        "rock-b"
      ],
      note: "flat slab, 33 mm (scaled in game): a six-sided plate with near-vertical planar sides, chamfered and rounded edges, a smaller plate lying on one end so a ledge steps across the top; material stone (grey-brown); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "7b35e21d4323ed811f91ed6d8d845b02dded6d3ebc2734697408d4c63a73659f",
      source: {
        procedural: {
          builder: "rock_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "gateway-pass",
        "sunset-highway",
        "ancient-ruins"
      ],
      tris: 588,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-b/lod2": {
      bounds_m: [
        [
          -0.04005726578020378,
          0,
          -0.06511786987712344
        ],
        [
          0.039709982614126775,
          0.03505653714029594,
          0.06423651988951647
        ]
      ],
      bytes: 5508,
      emissive: [],
      file: "91db1bad31b7c201b80fd97189df76a1d34bf9a1173465bf0ff4911680f36334.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-b/lod0",
        "model/rock-b/lod1",
        "model/rock-b/lod2"
      ],
      materials: [
        "stone"
      ],
      nodes: [
        "rock-b"
      ],
      note: "flat slab, 33 mm (scaled in game): a six-sided plate with near-vertical planar sides, chamfered and rounded edges, a smaller plate lying on one end so a ledge steps across the top; material stone (grey-brown); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "91db1bad31b7c201b80fd97189df76a1d34bf9a1173465bf0ff4911680f36334",
      source: {
        procedural: {
          builder: "rock_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "gateway-pass",
        "sunset-highway",
        "ancient-ruins"
      ],
      tris: 146,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-desert-a/lod0": {
      bounds_m: [
        [
          -1.29128476529357,
          0,
          -0.5431776583842364
        ],
        [
          1.2899277361523078,
          0.901361714398396,
          0.5432184774292523
        ]
      ],
      bytes: 1013808,
      emissive: [],
      file: "5d3c8a044ff639f292d906e29ae9816facf2e677fbdb483b5f9762ddc0f48219.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-desert-a/lod0",
        "model/rock-desert-a/lod1",
        "model/rock-desert-a/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-desert-a"
      ],
      note: "sandstone tumble, 0.88 m: three blocks with battered planar sides, chamfered and rounded edges, tilted flat tops, the middle one tallest, a cream stratum across all three; materials sandstone (red-orange), sandstone_band (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "5d3c8a044ff639f292d906e29ae9816facf2e677fbdb483b5f9762ddc0f48219",
      source: {
        procedural: {
          builder: "rock_desert_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway"
      ],
      tris: 2724,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-desert-a/lod1": {
      bounds_m: [
        [
          -1.291334341355104,
          0,
          -0.5426617132805306
        ],
        [
          1.288675160395968,
          0.9014261480853587,
          0.5438683003780687
        ]
      ],
      bytes: 946028,
      emissive: [],
      file: "5f4681a44a717dedac4c67c502e9524130e6f8e0890623095b5a1f46676b3f32.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-desert-a/lod0",
        "model/rock-desert-a/lod1",
        "model/rock-desert-a/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-desert-a"
      ],
      note: "sandstone tumble, 0.88 m: three blocks with battered planar sides, chamfered and rounded edges, tilted flat tops, the middle one tallest, a cream stratum across all three; materials sandstone (red-orange), sandstone_band (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "5f4681a44a717dedac4c67c502e9524130e6f8e0890623095b5a1f46676b3f32",
      source: {
        procedural: {
          builder: "rock_desert_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway"
      ],
      tris: 794,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-desert-a/lod2": {
      bounds_m: [
        [
          -1.2803189154350454,
          0,
          -0.5444874693812256
        ],
        [
          1.2879035371221188,
          0.8954909345881115,
          0.5401154596704045
        ]
      ],
      bytes: 921176,
      emissive: [],
      file: "3ece653fa95eadb470db19bdfe059baab8b671e32c373422ec449241654ca7ce.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-desert-a/lod0",
        "model/rock-desert-a/lod1",
        "model/rock-desert-a/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-desert-a"
      ],
      note: "sandstone tumble, 0.88 m: three blocks with battered planar sides, chamfered and rounded edges, tilted flat tops, the middle one tallest, a cream stratum across all three; materials sandstone (red-orange), sandstone_band (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "3ece653fa95eadb470db19bdfe059baab8b671e32c373422ec449241654ca7ce",
      source: {
        procedural: {
          builder: "rock_desert_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway"
      ],
      tris: 198,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-desert-b/lod0": {
      bounds_m: [
        [
          -1.3143755803339825,
          0,
          -1.096594777854795
        ],
        [
          1.3148743776556833,
          1.9329904741810349,
          1.097015390462563
        ]
      ],
      bytes: 1003468,
      emissive: [],
      file: "c13970c6004acb84849feb555e2004e5886470ef695b8f6021161054f9f0bd08.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-desert-b/lod0",
        "model/rock-desert-b/lod1",
        "model/rock-desert-b/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-desert-b"
      ],
      note: "sandstone stack, 1.9 m: three strata with battered planar sides, chamfered and rounded edges, each stepping back at a flat ledge, a tilted cap block, cream bands through the lower two; materials sandstone (red-orange), sandstone_band (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "c13970c6004acb84849feb555e2004e5886470ef695b8f6021161054f9f0bd08",
      source: {
        procedural: {
          builder: "rock_desert_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway"
      ],
      tris: 2534,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-desert-b/lod1": {
      bounds_m: [
        [
          -1.3155854116679984,
          0,
          -1.096594777854795
        ],
        [
          1.3162769784042512,
          1.9268132358557246,
          1.097015390462563
        ]
      ],
      bytes: 943900,
      emissive: [],
      file: "7c11febbcb422e0de2c15e6da7847b9c2543d4093a924b12437cd8135f9ab515.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-desert-b/lod0",
        "model/rock-desert-b/lod1",
        "model/rock-desert-b/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-desert-b"
      ],
      note: "sandstone stack, 1.9 m: three strata with battered planar sides, chamfered and rounded edges, each stepping back at a flat ledge, a tilted cap block, cream bands through the lower two; materials sandstone (red-orange), sandstone_band (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "7c11febbcb422e0de2c15e6da7847b9c2543d4093a924b12437cd8135f9ab515",
      source: {
        procedural: {
          builder: "rock_desert_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway"
      ],
      tris: 772,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-desert-b/lod2": {
      bounds_m: [
        [
          -1.3170210956704436,
          0,
          -1.092913770855837
        ],
        [
          1.3133635233271352,
          1.8734538939988437,
          1.0991139734315638
        ]
      ],
      bytes: 921088,
      emissive: [],
      file: "d3a8c8c21e1adae6047cfbda44fb1ff861e049805a29c70676f713abbd53028c.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-desert-b/lod0",
        "model/rock-desert-b/lod1",
        "model/rock-desert-b/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-desert-b"
      ],
      note: "sandstone stack, 1.9 m: three strata with battered planar sides, chamfered and rounded edges, each stepping back at a flat ledge, a tilted cap block, cream bands through the lower two; materials sandstone (red-orange), sandstone_band (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "d3a8c8c21e1adae6047cfbda44fb1ff861e049805a29c70676f713abbd53028c",
      source: {
        procedural: {
          builder: "rock_desert_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway"
      ],
      tris: 200,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-desert-c/lod0": {
      bounds_m: [
        [
          -0.6997689585125344,
          0,
          -0.3730413335740516
        ],
        [
          0.7000122211251429,
          0.5646045901173194,
          0.3720134211998658
        ]
      ],
      bytes: 1009240,
      emissive: [],
      file: "e0a549a2054022bedba2e30c5a6c92b0cfb50736c30098f4b23d7124b8ca67c2.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-desert-c/lod0",
        "model/rock-desert-c/lod1",
        "model/rock-desert-c/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-desert-c"
      ],
      note: "sandstone slab, 0.54 m: a flat-topped block with battered planar sides, chamfered and rounded edges, a lower block stepping down one end, a cream stratum low on its flanks; materials sandstone (red-orange), sandstone_band (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "e0a549a2054022bedba2e30c5a6c92b0cfb50736c30098f4b23d7124b8ca67c2",
      source: {
        procedural: {
          builder: "rock_desert_c",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "desert-canyons",
        "ancient-ruins"
      ],
      tris: 2696,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-desert-c/lod1": {
      bounds_m: [
        [
          -0.6990001375815752,
          0,
          -0.3733012898198415
        ],
        [
          0.6997855822758907,
          0.5647504072423158,
          0.37141985270968086
        ]
      ],
      bytes: 944716,
      emissive: [],
      file: "e7be6fc61d335887003cf3d923af5de4da44edd1d50ef87d99bac78cd22d9f07.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-desert-c/lod0",
        "model/rock-desert-c/lod1",
        "model/rock-desert-c/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-desert-c"
      ],
      note: "sandstone slab, 0.54 m: a flat-topped block with battered planar sides, chamfered and rounded edges, a lower block stepping down one end, a cream stratum low on its flanks; materials sandstone (red-orange), sandstone_band (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "e7be6fc61d335887003cf3d923af5de4da44edd1d50ef87d99bac78cd22d9f07",
      source: {
        procedural: {
          builder: "rock_desert_c",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "desert-canyons",
        "ancient-ruins"
      ],
      tris: 788,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-desert-c/lod2": {
      bounds_m: [
        [
          -0.7151010895854302,
          0,
          -0.373011402432571
        ],
        [
          0.6989829315689599,
          0.5619378217872234,
          0.37289960959186114
        ]
      ],
      bytes: 920348,
      emissive: [],
      file: "bbb94bd2854275a3778bef6ab3146b51fee96698bb897bc5b805088997765618.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-desert-c/lod0",
        "model/rock-desert-c/lod1",
        "model/rock-desert-c/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-desert-c"
      ],
      note: "sandstone slab, 0.54 m: a flat-topped block with battered planar sides, chamfered and rounded edges, a lower block stepping down one end, a cream stratum low on its flanks; materials sandstone (red-orange), sandstone_band (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      sha256: "bbb94bd2854275a3778bef6ab3146b51fee96698bb897bc5b805088997765618",
      source: {
        procedural: {
          builder: "rock_desert_c",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "45d94a2dedb4c346223498e49e464f7cd4540415030e503986c6d6cb7b37fe1a",
            sdf: "scripts/toon.py",
            sdf_sha256: "10f99f7d02e8134995a8f80e74d253308df3a57e268a97c50d89fd01a61e77c9"
          },
          script: "scripts/rocks.py",
          script_sha256: "7ba62496999c1e8e4108c56ae849bf7b1fa9dc0916bd98c63f29d99b10a393fb"
        }
      },
      stages: [
        "desert-canyons",
        "ancient-ruins"
      ],
      tris: 184,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-a/lod0": {
      bounds_m: [
        [
          -1.4535580421712342,
          0,
          -1.227323485447
        ],
        [
          1.451994406645887,
          1.9214261685253857,
          1.2272369705691328
        ]
      ],
      bytes: 1042592,
      emissive: [],
      file: "639a888c2cb950b8ce5d30ad82426da9a6ccb3772126c35538030f6b9ace214c.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-a/lod0",
        "model/rock-granite-a/lod1",
        "model/rock-granite-a/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-a"
      ],
      note: "granite boulder: a big lumpy dome with a lower lobe fused on, six chunky fracture planes, lichen on its top; materials granite (grey-blue), lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "639a888c2cb950b8ce5d30ad82426da9a6ccb3772126c35538030f6b9ace214c",
      source: {
        procedural: {
          builder: "granite_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 2976,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-a/lod1": {
      bounds_m: [
        [
          -1.4489112669797883,
          0,
          -1.2249775918338823
        ],
        [
          1.4494333164330004,
          1.9203445283599268,
          1.2218423607083775
        ]
      ],
      bytes: 974572,
      emissive: [],
      file: "770094fbca2f1afc895650ccf19c75c273e50dc3379cbee599510c9eec0ec14d.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-a/lod0",
        "model/rock-granite-a/lod1",
        "model/rock-granite-a/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-a"
      ],
      note: "granite boulder: a big lumpy dome with a lower lobe fused on, six chunky fracture planes, lichen on its top; materials granite (grey-blue), lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "770094fbca2f1afc895650ccf19c75c273e50dc3379cbee599510c9eec0ec14d",
      source: {
        procedural: {
          builder: "granite_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 824,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-a/lod2": {
      bounds_m: [
        [
          -1.454571498158325,
          0,
          -1.2164977802613146
        ],
        [
          1.4519332397554519,
          1.920309746342541,
          1.215060695913489
        ]
      ],
      bytes: 953424,
      emissive: [],
      file: "a04dab3e2827719285b97fb2eb4e5dcb9ba48a293b29d26a47ea2d140c7e5306.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-a/lod0",
        "model/rock-granite-a/lod1",
        "model/rock-granite-a/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-a"
      ],
      note: "granite boulder: a big lumpy dome with a lower lobe fused on, six chunky fracture planes, lichen on its top; materials granite (grey-blue), lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "a04dab3e2827719285b97fb2eb4e5dcb9ba48a293b29d26a47ea2d140c7e5306",
      source: {
        procedural: {
          builder: "granite_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 206,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-b/lod0": {
      bounds_m: [
        [
          -1.2205865422650688,
          0,
          -1.041251829889667
        ],
        [
          1.2176100954906917,
          1.7122058190049565,
          1.0405592047920924
        ]
      ],
      bytes: 1035392,
      emissive: [],
      file: "3eee2fe0ed60652deec4f954e4a50ebcb4d12dfd24807464bec37fda78ab84cf.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-b/lod0",
        "model/rock-granite-b/lod1",
        "model/rock-granite-b/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-b"
      ],
      note: "split granite boulder: a broken rounded boulder cracked in two along a jagged plane, the smaller half fallen away, lichen on top; materials granite, lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "3eee2fe0ed60652deec4f954e4a50ebcb4d12dfd24807464bec37fda78ab84cf",
      source: {
        procedural: {
          builder: "granite_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 2836,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-b/lod1": {
      bounds_m: [
        [
          -1.2216007103106654,
          0,
          -1.0387237797417004
        ],
        [
          1.2209758864365632,
          1.7122058190049565,
          1.0421146684236837
        ]
      ],
      bytes: 973432,
      emissive: [],
      file: "7ecaa64ffa5d4b4d7774e4e5e7c273a3d7a3f8dab7a1e8ffa844a24e3be8d4f3.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-b/lod0",
        "model/rock-granite-b/lod1",
        "model/rock-granite-b/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-b"
      ],
      note: "split granite boulder: a broken rounded boulder cracked in two along a jagged plane, the smaller half fallen away, lichen on top; materials granite, lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "7ecaa64ffa5d4b4d7774e4e5e7c273a3d7a3f8dab7a1e8ffa844a24e3be8d4f3",
      source: {
        procedural: {
          builder: "granite_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 828,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-b/lod2": {
      bounds_m: [
        [
          -1.2142726984996748,
          0,
          -1.03466346843643
        ],
        [
          1.2109180570099303,
          1.7072767086269374,
          1.0374034728110544
        ]
      ],
      bytes: 953148,
      emissive: [],
      file: "e4651d093086f1d9d41a447ce338042d63fcea65c13587d45ec3c49f7d4d6532.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-b/lod0",
        "model/rock-granite-b/lod1",
        "model/rock-granite-b/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-b"
      ],
      note: "split granite boulder: a broken rounded boulder cracked in two along a jagged plane, the smaller half fallen away, lichen on top; materials granite, lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "e4651d093086f1d9d41a447ce338042d63fcea65c13587d45ec3c49f7d4d6532",
      source: {
        procedural: {
          builder: "granite_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 206,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-c/lod0": {
      bounds_m: [
        [
          -1.308570687626797,
          0,
          -0.9606617637350225
        ],
        [
          1.307796202529845,
          0.6086848301777343,
          0.9613962809620925
        ]
      ],
      bytes: 1032472,
      emissive: [],
      file: "c9f7c0093b4603c6af51ebc23eee85dc1273ae1d3d425d3be6e75a96e45fde62.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-c/lod0",
        "model/rock-granite-c/lod1",
        "model/rock-granite-c/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-c"
      ],
      note: "granite slab: a broad slab tipped up at one end, a stepped fracture across its top, broken edges all round, lichen; materials granite, lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "c9f7c0093b4603c6af51ebc23eee85dc1273ae1d3d425d3be6e75a96e45fde62",
      source: {
        procedural: {
          builder: "granite_c",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 2576,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-c/lod1": {
      bounds_m: [
        [
          -1.3080975521189426,
          0,
          -0.9579624917344496
        ],
        [
          1.308527932573831,
          0.6085509961855439,
          0.9611360527481757
        ]
      ],
      bytes: 976320,
      emissive: [],
      file: "4f8e231ed28df8e751cd2ad803d81c323d1b9d9530a0461607530c2b9f9d996f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-c/lod0",
        "model/rock-granite-c/lod1",
        "model/rock-granite-c/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-c"
      ],
      note: "granite slab: a broad slab tipped up at one end, a stepped fracture across its top, broken edges all round, lichen; materials granite, lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "4f8e231ed28df8e751cd2ad803d81c323d1b9d9530a0461607530c2b9f9d996f",
      source: {
        procedural: {
          builder: "granite_c",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 824,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-c/lod2": {
      bounds_m: [
        [
          -1.3098319071442799,
          0,
          -0.9488602302891493
        ],
        [
          1.2966801912307047,
          0.6078262739026207,
          0.9587105670600765
        ]
      ],
      bytes: 954212,
      emissive: [],
      file: "64c4abb79777b08632bbaf8ecaf9f0e97bbed1391e839717249b9e18f2024bc1.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-c/lod0",
        "model/rock-granite-c/lod1",
        "model/rock-granite-c/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-c"
      ],
      note: "granite slab: a broad slab tipped up at one end, a stepped fracture across its top, broken edges all round, lichen; materials granite, lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "64c4abb79777b08632bbaf8ecaf9f0e97bbed1391e839717249b9e18f2024bc1",
      source: {
        procedural: {
          builder: "granite_c",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 206,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-d/lod0": {
      bounds_m: [
        [
          -1.1512152250505336,
          0,
          -0.9721473655657341
        ],
        [
          1.1547293947662027,
          2.906343684061725,
          0.9707171727248666
        ]
      ],
      bytes: 1041412,
      emissive: [],
      file: "6a5736398738ef588919171671191608a7a80bc9b0e04bc7d50296072c890a8e.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-d/lod0",
        "model/rock-granite-d/lod1",
        "model/rock-granite-d/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-d"
      ],
      note: "granite tor: four broad rounded blocks stacked off-centre, each smaller and turned its own way, the second overhanging, vertical joint faces, lichen on the ledges; materials granite, lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "6a5736398738ef588919171671191608a7a80bc9b0e04bc7d50296072c890a8e",
      source: {
        procedural: {
          builder: "granite_d",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 2986,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-d/lod1": {
      bounds_m: [
        [
          -1.153080691792056,
          0,
          -0.9601518579130217
        ],
        [
          1.1536863153708745,
          2.904473231918802,
          0.9621543879132393
        ]
      ],
      bytes: 974036,
      emissive: [],
      file: "df87bb013e9ddc61d595234679b928fb37e9b7d8ebbc4718e1d422074796aef7.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-d/lod0",
        "model/rock-granite-d/lod1",
        "model/rock-granite-d/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-d"
      ],
      note: "granite tor: four broad rounded blocks stacked off-centre, each smaller and turned its own way, the second overhanging, vertical joint faces, lichen on the ledges; materials granite, lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "df87bb013e9ddc61d595234679b928fb37e9b7d8ebbc4718e1d422074796aef7",
      source: {
        procedural: {
          builder: "granite_d",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 816,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-d/lod2": {
      bounds_m: [
        [
          -1.131736353263144,
          0,
          -0.9419650307034164
        ],
        [
          1.1351658828834692,
          2.9154071490939186,
          0.9592765599631761
        ]
      ],
      bytes: 953580,
      emissive: [],
      file: "01ad5b2540b6ddb405c00a497fd8b1dd33c62d4f62b1d3ce32c2a70a5ae822b6.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-d/lod0",
        "model/rock-granite-d/lod1",
        "model/rock-granite-d/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-d"
      ],
      note: "granite tor: four broad rounded blocks stacked off-centre, each smaller and turned its own way, the second overhanging, vertical joint faces, lichen on the ledges; materials granite, lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "01ad5b2540b6ddb405c00a497fd8b1dd33c62d4f62b1d3ce32c2a70a5ae822b6",
      source: {
        procedural: {
          builder: "granite_d",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 210,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-e/lod0": {
      bounds_m: [
        [
          -1.40144456963942,
          0,
          -1.2227776075906027
        ],
        [
          1.4025514011774434,
          1.614296520058777,
          1.2231078915773852
        ]
      ],
      bytes: 1068688,
      emissive: [],
      file: "504648fbe806270b568d37c2b418a10489beac585ba2b7c93f5d5ccb54b4eea1.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-e/lod0",
        "model/rock-granite-e/lod1",
        "model/rock-granite-e/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-e"
      ],
      note: "granite cluster: one big broken boulder and three small broken boulders fused at its foot, lichen; materials granite, lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "504648fbe806270b568d37c2b418a10489beac585ba2b7c93f5d5ccb54b4eea1",
      source: {
        procedural: {
          builder: "granite_e",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 3776,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-e/lod1": {
      bounds_m: [
        [
          -1.4015105904300418,
          0,
          -1.2227614446738244
        ],
        [
          1.4019487686633092,
          1.6146728421975467,
          1.2200525487954188
        ]
      ],
      bytes: 989864,
      emissive: [],
      file: "5a1d3cb71f7fea36281ddd359129433813b3f3a48e09a56e03d6923ce2fa1976.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-e/lod0",
        "model/rock-granite-e/lod1",
        "model/rock-granite-e/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-e"
      ],
      note: "granite cluster: one big broken boulder and three small broken boulders fused at its foot, lichen; materials granite, lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "5a1d3cb71f7fea36281ddd359129433813b3f3a48e09a56e03d6923ce2fa1976",
      source: {
        procedural: {
          builder: "granite_e",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 1252,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-granite-e/lod2": {
      bounds_m: [
        [
          -1.3985746768974845,
          0,
          -1.217154269057613
        ],
        [
          1.3838195263393958,
          1.6022482494531154,
          1.2154361371459819
        ]
      ],
      bytes: 958036,
      emissive: [],
      file: "34bba4e0af5263602b6200bf46f235660416c42dc5ae45a6cfb6127aab06b216.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-granite-e/lod0",
        "model/rock-granite-e/lod1",
        "model/rock-granite-e/lod2"
      ],
      materials: [
        "granite",
        "lichen"
      ],
      nodes: [
        "rock-granite-e"
      ],
      note: "granite cluster: one big broken boulder and three small broken boulders fused at its foot, lichen; materials granite, lichen; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "granite",
      sha256: "34bba4e0af5263602b6200bf46f235660416c42dc5ae45a6cfb6127aab06b216",
      source: {
        procedural: {
          builder: "granite_e",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass",
        "wilderness-run",
        "coastal-cliffs"
      ],
      tris: 314,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-lime-a/lod0": {
      bounds_m: [
        [
          -0.8689129089890469,
          0,
          -0.8259307514635683
        ],
        [
          0.8698897904672555,
          1.2513199988692016,
          0.8255029237747702
        ]
      ],
      bytes: 1014756,
      emissive: [],
      file: "d4e280e0f668a02b08f73d1fa168433d49411f12276fd78c13339fb486eeeb6c.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-lime-a/lod0",
        "model/rock-lime-a/lod1",
        "model/rock-lime-a/lod2"
      ],
      materials: [
        "limestone"
      ],
      nodes: [
        "rock-lime-a"
      ],
      note: "weathered limestone block: a worn, slightly tapering block with a patchy bedding groove and six old breaks of mixed depth; material limestone (warm pale); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "limestone",
      sha256: "d4e280e0f668a02b08f73d1fa168433d49411f12276fd78c13339fb486eeeb6c",
      source: {
        procedural: {
          builder: "lime_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "ancient-ruins",
        "coastal-cliffs",
        "gateway-pass",
        "destination-castle"
      ],
      tris: 2454,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-lime-a/lod1": {
      bounds_m: [
        [
          -0.8681446935380914,
          0,
          -0.8255341916871449
        ],
        [
          0.8665734361802108,
          1.2510092252507898,
          0.8243259665155307
        ]
      ],
      bytes: 966728,
      emissive: [],
      file: "5341605dafbc0f403378f7953a36769b2b7bca32d404d536de017edcfb10b7dc.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-lime-a/lod0",
        "model/rock-lime-a/lod1",
        "model/rock-lime-a/lod2"
      ],
      materials: [
        "limestone"
      ],
      nodes: [
        "rock-lime-a"
      ],
      note: "weathered limestone block: a worn, slightly tapering block with a patchy bedding groove and six old breaks of mixed depth; material limestone (warm pale); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "limestone",
      sha256: "5341605dafbc0f403378f7953a36769b2b7bca32d404d536de017edcfb10b7dc",
      source: {
        procedural: {
          builder: "lime_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "ancient-ruins",
        "coastal-cliffs",
        "gateway-pass",
        "destination-castle"
      ],
      tris: 780,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-lime-a/lod2": {
      bounds_m: [
        [
          -0.8605533130113387,
          0,
          -0.8245429346333104
        ],
        [
          0.8636630841592345,
          1.2417706656272813,
          0.818330016316677
        ]
      ],
      bytes: 948728,
      emissive: [],
      file: "5ee8b3fe13101265870cad710129fa971a81d2305bc53e026fd3698a6d1a10eb.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-lime-a/lod0",
        "model/rock-lime-a/lod1",
        "model/rock-lime-a/lod2"
      ],
      materials: [
        "limestone"
      ],
      nodes: [
        "rock-lime-a"
      ],
      note: "weathered limestone block: a worn, slightly tapering block with a patchy bedding groove and six old breaks of mixed depth; material limestone (warm pale); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "limestone",
      sha256: "5ee8b3fe13101265870cad710129fa971a81d2305bc53e026fd3698a6d1a10eb",
      source: {
        procedural: {
          builder: "lime_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "ancient-ruins",
        "coastal-cliffs",
        "gateway-pass",
        "destination-castle"
      ],
      tris: 194,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-lime-b/lod0": {
      bounds_m: [
        [
          -1.0814745390229152,
          0,
          -0.7101331084376763
        ],
        [
          1.0806779097069164,
          0.6857811537421623,
          0.7105055428139582
        ]
      ],
      bytes: 1009136,
      emissive: [],
      file: "b807662531c7f200b7dcf77df98e1d2c201b3b846cf575aa375a5e2372fa4932.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-lime-b/lod0",
        "model/rock-lime-b/lod1",
        "model/rock-lime-b/lod2"
      ],
      materials: [
        "limestone"
      ],
      nodes: [
        "rock-lime-b"
      ],
      note: "broken limestone slab: a bedded slab tipped up, its high end snapped off in three jagged faces, a thinner broken bed lying on it; material limestone; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "limestone",
      sha256: "b807662531c7f200b7dcf77df98e1d2c201b3b846cf575aa375a5e2372fa4932",
      source: {
        procedural: {
          builder: "lime_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "ancient-ruins",
        "coastal-cliffs",
        "gateway-pass",
        "destination-castle"
      ],
      tris: 2222,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-lime-b/lod1": {
      bounds_m: [
        [
          -1.081463010167874,
          0,
          -0.7097400617722045
        ],
        [
          1.0800934315403863,
          0.6857196244209564,
          0.7099305589078285
        ]
      ],
      bytes: 966772,
      emissive: [],
      file: "c71d8b5323744984de5269c2679c9caa8f68fe25087239450c57f33b605d2736.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-lime-b/lod0",
        "model/rock-lime-b/lod1",
        "model/rock-lime-b/lod2"
      ],
      materials: [
        "limestone"
      ],
      nodes: [
        "rock-lime-b"
      ],
      note: "broken limestone slab: a bedded slab tipped up, its high end snapped off in three jagged faces, a thinner broken bed lying on it; material limestone; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "limestone",
      sha256: "c71d8b5323744984de5269c2679c9caa8f68fe25087239450c57f33b605d2736",
      source: {
        procedural: {
          builder: "lime_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "ancient-ruins",
        "coastal-cliffs",
        "gateway-pass",
        "destination-castle"
      ],
      tris: 780,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-lime-b/lod2": {
      bounds_m: [
        [
          -1.0713326454700016,
          0,
          -0.7084230783898183
        ],
        [
          1.073125041117064,
          0.6818682343597855,
          0.7068269791482366
        ]
      ],
      bytes: 948864,
      emissive: [],
      file: "955b53aea9369f4d69e44af6eb645091192e31d6a88cabb919a271a6032a49d9.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-lime-b/lod0",
        "model/rock-lime-b/lod1",
        "model/rock-lime-b/lod2"
      ],
      materials: [
        "limestone"
      ],
      nodes: [
        "rock-lime-b"
      ],
      note: "broken limestone slab: a bedded slab tipped up, its high end snapped off in three jagged faces, a thinner broken bed lying on it; material limestone; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "limestone",
      sha256: "955b53aea9369f4d69e44af6eb645091192e31d6a88cabb919a271a6032a49d9",
      source: {
        procedural: {
          builder: "lime_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "ancient-ruins",
        "coastal-cliffs",
        "gateway-pass",
        "destination-castle"
      ],
      tris: 194,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-lime-c/lod0": {
      bounds_m: [
        [
          -0.9394704510390137,
          0,
          -0.6256037157000237
        ],
        [
          0.9398741622216945,
          0.657709517651899,
          0.6254976983589441
        ]
      ],
      bytes: 1047528,
      emissive: [],
      file: "633d8442cb91aab90f143b3ce8be0a98c4952a9d2e48fddf987fa11d657a8e1f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-lime-c/lod0",
        "model/rock-lime-c/lod1",
        "model/rock-lime-c/lod2"
      ],
      materials: [
        "limestone"
      ],
      nodes: [
        "rock-lime-c"
      ],
      note: "limestone pile: six broken stones of mixed size heaped, the top one perched; material limestone; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "limestone",
      sha256: "633d8442cb91aab90f143b3ce8be0a98c4952a9d2e48fddf987fa11d657a8e1f",
      source: {
        procedural: {
          builder: "lime_c",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "ancient-ruins",
        "coastal-cliffs",
        "gateway-pass",
        "destination-castle"
      ],
      tris: 3428,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-lime-c/lod1": {
      bounds_m: [
        [
          -0.9392012359530925,
          0,
          -0.624848891496121
        ],
        [
          0.9396521296547106,
          0.657709517651899,
          0.6262231478642107
        ]
      ],
      bytes: 980288,
      emissive: [],
      file: "a6bb26422b325fb14a0b2f74401647d8c0649f1b5c1de5e8d0dab96859fee041.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-lime-c/lod0",
        "model/rock-lime-c/lod1",
        "model/rock-lime-c/lod2"
      ],
      materials: [
        "limestone"
      ],
      nodes: [
        "rock-lime-c"
      ],
      note: "limestone pile: six broken stones of mixed size heaped, the top one perched; material limestone; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "limestone",
      sha256: "a6bb26422b325fb14a0b2f74401647d8c0649f1b5c1de5e8d0dab96859fee041",
      source: {
        procedural: {
          builder: "lime_c",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "ancient-ruins",
        "coastal-cliffs",
        "gateway-pass",
        "destination-castle"
      ],
      tris: 1170,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-lime-c/lod2": {
      bounds_m: [
        [
          -0.9382733639404316,
          0,
          -0.6268528414831015
        ],
        [
          0.9406522269315607,
          0.6527848252122688,
          0.6259247609806281
        ]
      ],
      bytes: 952444,
      emissive: [],
      file: "9d0817f66ac789c6bbd9becb36ef4f40327e9ccb9630d8e087efbc5a33c05b8a.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-lime-c/lod0",
        "model/rock-lime-c/lod1",
        "model/rock-lime-c/lod2"
      ],
      materials: [
        "limestone"
      ],
      nodes: [
        "rock-lime-c"
      ],
      note: "limestone pile: six broken stones of mixed size heaped, the top one perched; material limestone; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "limestone",
      sha256: "9d0817f66ac789c6bbd9becb36ef4f40327e9ccb9630d8e087efbc5a33c05b8a",
      source: {
        procedural: {
          builder: "lime_c",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "ancient-ruins",
        "coastal-cliffs",
        "gateway-pass",
        "destination-castle"
      ],
      tris: 292,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-lime-d/lod0": {
      bounds_m: [
        [
          -1.2992966248822413,
          0,
          -1.0208035165421725
        ],
        [
          1.2996670558208032,
          1.542626340038199,
          1.0238846013008158
        ]
      ],
      bytes: 1056664,
      emissive: [],
      file: "2943eef6b9dabd96532b0719b95b4a508c2cb04fa210a6d2a3cb586e9f91b738.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-lime-d/lod0",
        "model/rock-lime-d/lod1",
        "model/rock-lime-d/lod2"
      ],
      materials: [
        "limestone"
      ],
      nodes: [
        "rock-lime-d"
      ],
      note: "limestone cluster: a tall weathered block with bedding grooves and broken faces, three smaller blocks fused round its foot; material limestone; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "limestone",
      sha256: "2943eef6b9dabd96532b0719b95b4a508c2cb04fa210a6d2a3cb586e9f91b738",
      source: {
        procedural: {
          builder: "lime_d",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "ancient-ruins",
        "coastal-cliffs",
        "gateway-pass",
        "destination-castle"
      ],
      tris: 3836,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-lime-d/lod1": {
      bounds_m: [
        [
          -1.2976494430481946,
          0,
          -1.015487799436193
        ],
        [
          1.2996670558208032,
          1.542928020920601,
          1.0209893200237663
        ]
      ],
      bytes: 978836,
      emissive: [],
      file: "3ffe87e03d908c9c3c3b92f643ac2f5af36a98602142de0cd6c2c0d864c87e58.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-lime-d/lod0",
        "model/rock-lime-d/lod1",
        "model/rock-lime-d/lod2"
      ],
      materials: [
        "limestone"
      ],
      nodes: [
        "rock-lime-d"
      ],
      note: "limestone cluster: a tall weathered block with bedding grooves and broken faces, three smaller blocks fused round its foot; material limestone; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "limestone",
      sha256: "3ffe87e03d908c9c3c3b92f643ac2f5af36a98602142de0cd6c2c0d864c87e58",
      source: {
        procedural: {
          builder: "lime_d",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "ancient-ruins",
        "coastal-cliffs",
        "gateway-pass",
        "destination-castle"
      ],
      tris: 1170,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-lime-d/lod2": {
      bounds_m: [
        [
          -1.263906499738995,
          0,
          -1.0000615614347064
        ],
        [
          1.2878597438358603,
          1.5394639222290094,
          1.0211683676154935
        ]
      ],
      bytes: 952004,
      emissive: [],
      file: "dd1ffabe72062fff86c92e2b1c4448fe8bb1719b9e7b539dc7022afe7e91ec17.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-lime-d/lod0",
        "model/rock-lime-d/lod1",
        "model/rock-lime-d/lod2"
      ],
      materials: [
        "limestone"
      ],
      nodes: [
        "rock-lime-d"
      ],
      note: "limestone cluster: a tall weathered block with bedding grooves and broken faces, three smaller blocks fused round its foot; material limestone; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "limestone",
      sha256: "dd1ffabe72062fff86c92e2b1c4448fe8bb1719b9e7b539dc7022afe7e91ec17",
      source: {
        procedural: {
          builder: "lime_d",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "ancient-ruins",
        "coastal-cliffs",
        "gateway-pass",
        "destination-castle"
      ],
      tris: 292,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-a/lod0": {
      bounds_m: [
        [
          -0.5814611575839835,
          0,
          -0.49942760718925955
        ],
        [
          0.5805099911403429,
          2.8321847799953517,
          0.5021116240585519
        ]
      ],
      bytes: 990324,
      emissive: [],
      file: "c2a3dbcb95fe73c3e80a93927cfd915c5fcadc56969264b5305dc46b25192c4e.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-a/lod0",
        "model/rock-sand-a/lod1",
        "model/rock-sand-a/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-a"
      ],
      note: "leaning sandstone pinnacle: a tapering column leaning well off the vertical, side fractures of mixed depth, a two-faced slanted crown, a proud cream ledge and patchy bedding grooves; materials sandstone (red-orange), sandstone_band (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "c2a3dbcb95fe73c3e80a93927cfd915c5fcadc56969264b5305dc46b25192c4e",
      source: {
        procedural: {
          builder: "sand_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 2434,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-a/lod1": {
      bounds_m: [
        [
          -0.5814520532591791,
          0,
          -0.498986582172121
        ],
        [
          0.5797360068116926,
          2.8302441980154387,
          0.5008648908866015
        ]
      ],
      bytes: 941228,
      emissive: [],
      file: "5b4d713fdac0b85c7b10f20c182ce36e27b2ac5bc169a81070317d80dfafd8ce.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-a/lod0",
        "model/rock-sand-a/lod1",
        "model/rock-sand-a/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-a"
      ],
      note: "leaning sandstone pinnacle: a tapering column leaning well off the vertical, side fractures of mixed depth, a two-faced slanted crown, a proud cream ledge and patchy bedding grooves; materials sandstone (red-orange), sandstone_band (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "5b4d713fdac0b85c7b10f20c182ce36e27b2ac5bc169a81070317d80dfafd8ce",
      source: {
        procedural: {
          builder: "sand_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 816,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-a/lod2": {
      bounds_m: [
        [
          -0.5701686382911852,
          0,
          -0.47717745921347243
        ],
        [
          0.5787471379863875,
          2.837717280452043,
          0.4955783586673419
        ]
      ],
      bytes: 920704,
      emissive: [],
      file: "673eb53eaddcbfcb177ad02ef6b64681f8aa23d71cd5c5d397b2c9b9fbdc17d4.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-a/lod0",
        "model/rock-sand-a/lod1",
        "model/rock-sand-a/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-a"
      ],
      note: "leaning sandstone pinnacle: a tapering column leaning well off the vertical, side fractures of mixed depth, a two-faced slanted crown, a proud cream ledge and patchy bedding grooves; materials sandstone (red-orange), sandstone_band (cream); Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "673eb53eaddcbfcb177ad02ef6b64681f8aa23d71cd5c5d397b2c9b9fbdc17d4",
      source: {
        procedural: {
          builder: "sand_a",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 208,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-b/lod0": {
      bounds_m: [
        [
          -1.168375443443616,
          0,
          -0.9821717127198752
        ],
        [
          1.1647928539997425,
          1.441657608088745,
          0.9848699996592433
        ]
      ],
      bytes: 1000328,
      emissive: [],
      file: "86f617ff2a1bc833c7d746fba20cc01be19fb58fdf74edf3ff07d80d38ce3208.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-b/lod0",
        "model/rock-sand-b/lod1",
        "model/rock-sand-b/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-b"
      ],
      note: "wind-worn sandstone boulder: three fused lobes, a wind-scooped hollow undercutting one side, one crisp broken face, steeply dipping bedding with a cream band; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "86f617ff2a1bc833c7d746fba20cc01be19fb58fdf74edf3ff07d80d38ce3208",
      source: {
        procedural: {
          builder: "sand_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 2744,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-b/lod1": {
      bounds_m: [
        [
          -1.162625607349633,
          0,
          -0.9792064886627457
        ],
        [
          1.1653613241675052,
          1.4369463724497122,
          0.9824735782342845
        ]
      ],
      bytes: 941332,
      emissive: [],
      file: "37692184cad4466791d447497c7019baccc3d06aa636707cf093a04e76af0905.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-b/lod0",
        "model/rock-sand-b/lod1",
        "model/rock-sand-b/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-b"
      ],
      note: "wind-worn sandstone boulder: three fused lobes, a wind-scooped hollow undercutting one side, one crisp broken face, steeply dipping bedding with a cream band; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "37692184cad4466791d447497c7019baccc3d06aa636707cf093a04e76af0905",
      source: {
        procedural: {
          builder: "sand_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 834,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-b/lod2": {
      bounds_m: [
        [
          -1.1410302215204338,
          0,
          -0.9839340815833151
        ],
        [
          1.1523478034698083,
          1.4404492162941052,
          0.9815125593895357
        ]
      ],
      bytes: 920364,
      emissive: [],
      file: "90c9ac84c16ab82a4f863194a80ada40b05bdc5b1e4a3de33d712d53ede2f2b2.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-b/lod0",
        "model/rock-sand-b/lod1",
        "model/rock-sand-b/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-b"
      ],
      note: "wind-worn sandstone boulder: three fused lobes, a wind-scooped hollow undercutting one side, one crisp broken face, steeply dipping bedding with a cream band; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "90c9ac84c16ab82a4f863194a80ada40b05bdc5b1e4a3de33d712d53ede2f2b2",
      source: {
        procedural: {
          builder: "sand_b",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 210,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-c/lod0": {
      bounds_m: [
        [
          -1.50546346309933,
          0,
          -0.9972141470827329
        ],
        [
          1.5069439007151408,
          1.2212419039661622,
          0.9957408201932204
        ]
      ],
      bytes: 1006420,
      emissive: [],
      file: "e7fa6a4059723c50565bf3206d0baa9067679b9189fe2068c72f5f94c9eaa2fb.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-c/lod0",
        "model/rock-sand-c/lod1",
        "model/rock-sand-c/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-c"
      ],
      note: "sandstone ledge: an irregular flat caprock with overhanging cliffed sides over a narrower eroded base, a fallen block against one end, a cream band through the caprock; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "e7fa6a4059723c50565bf3206d0baa9067679b9189fe2068c72f5f94c9eaa2fb",
      source: {
        procedural: {
          builder: "sand_c",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 2976,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-c/lod1": {
      bounds_m: [
        [
          -1.5037048928926533,
          0,
          -0.9956232264994095
        ],
        [
          1.5029000184183354,
          1.2164546345562846,
          0.9930713325232626
        ]
      ],
      bytes: 941576,
      emissive: [],
      file: "d0e2cd8f45efdb54e0e4c4da0e6f4e40d509ef0cbddd81c2b9c6cd7e7bd2d463.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-c/lod0",
        "model/rock-sand-c/lod1",
        "model/rock-sand-c/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-c"
      ],
      note: "sandstone ledge: an irregular flat caprock with overhanging cliffed sides over a narrower eroded base, a fallen block against one end, a cream band through the caprock; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "d0e2cd8f45efdb54e0e4c4da0e6f4e40d509ef0cbddd81c2b9c6cd7e7bd2d463",
      source: {
        procedural: {
          builder: "sand_c",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 838,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-c/lod2": {
      bounds_m: [
        [
          -1.4910335013424572,
          0,
          -0.9851809910081708
        ],
        [
          1.4927930134812777,
          1.2180111264669362,
          0.981690477593899
        ]
      ],
      bytes: 92e4,
      emissive: [],
      file: "6d584a39f11819dca777d40343a56cbeac1c9e5d8318069e0e860a1e21f345c3.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-c/lod0",
        "model/rock-sand-c/lod1",
        "model/rock-sand-c/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-c"
      ],
      note: "sandstone ledge: an irregular flat caprock with overhanging cliffed sides over a narrower eroded base, a fallen block against one end, a cream band through the caprock; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "6d584a39f11819dca777d40343a56cbeac1c9e5d8318069e0e860a1e21f345c3",
      source: {
        procedural: {
          builder: "sand_c",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 208,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-d/lod0": {
      bounds_m: [
        [
          -1.0552948694450444,
          0,
          -0.8219185710473952
        ],
        [
          1.0587972796178806,
          1.9750507080237105,
          0.8215971731608795
        ]
      ],
      bytes: 1011396,
      emissive: [],
      file: "5be975c6a259fde5041834b1b14724dd57133427d0a996f4067b0cbf3a90b71e.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-d/lod0",
        "model/rock-sand-d/lod1",
        "model/rock-sand-d/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-d"
      ],
      note: "split sandstone block: a chunky block cracked clean through along a jagged plane, the smaller half leaning away, two cream bands; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "5be975c6a259fde5041834b1b14724dd57133427d0a996f4067b0cbf3a90b71e",
      source: {
        procedural: {
          builder: "sand_d",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 2808,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-d/lod1": {
      bounds_m: [
        [
          -1.057742409408467,
          0,
          -0.8206689520170141
        ],
        [
          1.0570000043060077,
          1.9745733904280531,
          0.8150569685397068
        ]
      ],
      bytes: 945108,
      emissive: [],
      file: "db93ebf15b21396d8e1ca962e716533ed9d9cbf403404f2c91b06e23fb0b269d.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-d/lod0",
        "model/rock-sand-d/lod1",
        "model/rock-sand-d/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-d"
      ],
      note: "split sandstone block: a chunky block cracked clean through along a jagged plane, the smaller half leaning away, two cream bands; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "db93ebf15b21396d8e1ca962e716533ed9d9cbf403404f2c91b06e23fb0b269d",
      source: {
        procedural: {
          builder: "sand_d",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 832,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-d/lod2": {
      bounds_m: [
        [
          -1.1009637344549852,
          0,
          -0.7809569444708471
        ],
        [
          1.0542384519164663,
          1.9834957533849236,
          0.8153843270299754
        ]
      ],
      bytes: 920748,
      emissive: [],
      file: "f71eaa9409915775786dfd3af23756e706973964bd51782397c02b0bdb1407be.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-d/lod0",
        "model/rock-sand-d/lod1",
        "model/rock-sand-d/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-d"
      ],
      note: "split sandstone block: a chunky block cracked clean through along a jagged plane, the smaller half leaning away, two cream bands; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "f71eaa9409915775786dfd3af23756e706973964bd51782397c02b0bdb1407be",
      source: {
        procedural: {
          builder: "sand_d",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 200,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-e/lod0": {
      bounds_m: [
        [
          -0.7681720080655468,
          0,
          -0.736213630390377
        ],
        [
          0.7703237116466014,
          1.7605122155525739,
          0.7385511597368937
        ]
      ],
      bytes: 996e3,
      emissive: [],
      file: "11b6cfcf4032f00f1a758cef7170c02d510f0068f088c371ca5e0581777e3d5f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-e/lod0",
        "model/rock-sand-e/lod1",
        "model/rock-sand-e/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-e"
      ],
      note: "sandstone hoodoo: a waisted, wind-eroded pedestal with bedding grooves under a wider, tilted caprock with broken edges, cream at its base; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "11b6cfcf4032f00f1a758cef7170c02d510f0068f088c371ca5e0581777e3d5f",
      source: {
        procedural: {
          builder: "sand_e",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 2706,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-e/lod1": {
      bounds_m: [
        [
          -0.7673240161886884,
          0,
          -0.7344813043293149
        ],
        [
          0.766048452844984,
          1.7597267420827838,
          0.73912607933645
        ]
      ],
      bytes: 939532,
      emissive: [],
      file: "bc5a670c3ef45daed8b27e2d62bde0dd62384638c4c935ecb074cf9713ef5e39.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-e/lod0",
        "model/rock-sand-e/lod1",
        "model/rock-sand-e/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-e"
      ],
      note: "sandstone hoodoo: a waisted, wind-eroded pedestal with bedding grooves under a wider, tilted caprock with broken edges, cream at its base; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "bc5a670c3ef45daed8b27e2d62bde0dd62384638c4c935ecb074cf9713ef5e39",
      source: {
        procedural: {
          builder: "sand_e",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 820,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-e/lod2": {
      bounds_m: [
        [
          -0.7747293074066535,
          0,
          -0.7369655107924052
        ],
        [
          0.7556739074404094,
          1.7605994358416506,
          0.7345217074056295
        ]
      ],
      bytes: 919484,
      emissive: [],
      file: "0e99d01b2c9fcc294b27a0b4afd20889608f803559b2fb51649eb81981fcd37d.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-e/lod0",
        "model/rock-sand-e/lod1",
        "model/rock-sand-e/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-e"
      ],
      note: "sandstone hoodoo: a waisted, wind-eroded pedestal with bedding grooves under a wider, tilted caprock with broken edges, cream at its base; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "0e99d01b2c9fcc294b27a0b4afd20889608f803559b2fb51649eb81981fcd37d",
      source: {
        procedural: {
          builder: "sand_e",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 210,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-f/lod0": {
      bounds_m: [
        [
          -1.2798248335518374,
          0,
          -0.7520023170182021
        ],
        [
          1.2803732645650818,
          0.9824747959592186,
          0.7529098742939434
        ]
      ],
      bytes: 1012456,
      emissive: [],
      file: "b23a3002d5d86045a454b43decb0b3fdc9ebb92ee15ae42ac1d9fa30623be938.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-f/lod0",
        "model/rock-sand-f/lod1",
        "model/rock-sand-f/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-f"
      ],
      note: "sandstone tumble: one big and three smaller angular blocks fused, each broken and tipped its own way, one resting across two, a cream band low through all; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "b23a3002d5d86045a454b43decb0b3fdc9ebb92ee15ae42ac1d9fa30623be938",
      source: {
        procedural: {
          builder: "sand_f",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 2918,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-f/lod1": {
      bounds_m: [
        [
          -1.2806937629575867,
          0,
          -0.7504721683712282
        ],
        [
          1.2775630884101197,
          0.9762849692523785,
          0.7519942517099344
        ]
      ],
      bytes: 945124,
      emissive: [],
      file: "8bd544bd42e31335972d1e37cf8481f302ec25b3412de773a23bdec9ee01eee6.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-f/lod0",
        "model/rock-sand-f/lod1",
        "model/rock-sand-f/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-f"
      ],
      note: "sandstone tumble: one big and three smaller angular blocks fused, each broken and tipped its own way, one resting across two, a cream band low through all; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "8bd544bd42e31335972d1e37cf8481f302ec25b3412de773a23bdec9ee01eee6",
      source: {
        procedural: {
          builder: "sand_f",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 836,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/rock-sand-f/lod2": {
      bounds_m: [
        [
          -1.277360504609163,
          0,
          -0.7554378501891479
        ],
        [
          1.263529142159861,
          0.9695496046165487,
          0.7468208369522792
        ]
      ],
      bytes: 921248,
      emissive: [],
      file: "1ec46cdb19ff1312b8dc76a61cb34f1826c51d0450eb95391367e87b0c11a68f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/rock-sand-f/lod0",
        "model/rock-sand-f/lod1",
        "model/rock-sand-f/lod2"
      ],
      materials: [
        "sandstone",
        "sandstone_band"
      ],
      nodes: [
        "rock-sand-f"
      ],
      note: "sandstone tumble: one big and three smaller angular blocks fused, each broken and tipped its own way, one resting across two, a cream band low through all; materials sandstone, sandstone_band; Y up, metres, origin on the ground at the footprint centre, +Z forward",
      set: "desert",
      sha256: "1ec46cdb19ff1312b8dc76a61cb34f1826c51d0450eb95391367e87b0c11a68f",
      source: {
        procedural: {
          builder: "sand_f",
          params: {
            pipeline: "scripts/build.py",
            pipeline_sha256: "2bfcaf37ebad218c1ed9c1dcfa5bd908221569b7f3f2c0f5d646b5e2a37f6520",
            sdf: "scripts/toon.py",
            sdf_sha256: "34132bd49d0d99cabbe749910381d2bab7cdc570e2f297ec7c61266d1cb220ee"
          },
          script: "scripts/rocks2.py",
          script_sha256: "da44223875b13293663e0f07db3c334adb074c3e61ec6f2b0d51582c61cacdf8"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway",
        "destination-oasis"
      ],
      tris: 210,
      vertex_colors: "COLOR_0 (VEC3 float): baked ambient occlusion x painted light, a multiplier of baseColor"
    },
    "model/sailboat/lod0": {
      bounds_m: [
        [
          -1.6797040458639265,
          -1.75,
          -4.811033164777311
        ],
        [
          1.6797040458639265,
          13.5,
          4.816648847357466
        ]
      ],
      bytes: 694104,
      emissive: [],
      file: "32ea8a60bf4d776d79c2baa7e16ea2db3740f1fc450ba88f04380c461aed84df.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/sailboat/lod0",
        "model/sailboat/lod1",
        "model/sailboat/lod2"
      ],
      materials: [
        "hull",
        "stripe",
        "antifoul",
        "deck",
        "glass",
        "spar",
        "sail",
        "rigging"
      ],
      nodes: [
        "sailboat"
      ],
      note: "waterline at y = 0 (keel and rudder below it); bow on +Z; sails are double-sided",
      sha256: "32ea8a60bf4d776d79c2baa7e16ea2db3740f1fc450ba88f04380c461aed84df",
      source: {
        procedural: {
          builder: "sailboat",
          params: {},
          script: "scripts/props.py",
          script_sha256: "36f819f502c05321db5a31b7fb88c7748ace0cfebafba08ad2403f4b8bb2ae57"
        }
      },
      tris: 1724
    },
    "model/sailboat/lod1": {
      bounds_m: [
        [
          -1.6799848606314995,
          -1.75,
          -4.810888311558673
        ],
        [
          1.6799848606314995,
          13.5,
          4.814251514996107
        ]
      ],
      bytes: 39980,
      emissive: [],
      file: "65f4b7d579977eb67144ee4f120da09e35a3f847f9adc6ed7736a97a7e784dab.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/sailboat/lod0",
        "model/sailboat/lod1",
        "model/sailboat/lod2"
      ],
      materials: [
        "hull",
        "stripe",
        "antifoul",
        "deck",
        "glass",
        "spar",
        "sail",
        "rigging"
      ],
      nodes: [
        "sailboat"
      ],
      note: "waterline at y = 0 (keel and rudder below it); bow on +Z; sails are double-sided",
      sha256: "65f4b7d579977eb67144ee4f120da09e35a3f847f9adc6ed7736a97a7e784dab",
      source: {
        procedural: {
          builder: "sailboat",
          params: {},
          script: "scripts/props.py",
          script_sha256: "36f819f502c05321db5a31b7fb88c7748ace0cfebafba08ad2403f4b8bb2ae57"
        }
      },
      tris: 800
    },
    "model/sailboat/lod2": {
      bounds_m: [
        [
          -1.6309311754487439,
          -1.75,
          -4.805
        ],
        [
          1.6309311754487439,
          13.5,
          4.795
        ]
      ],
      bytes: 15912,
      emissive: [],
      file: "2f99d688e3b91cf455f640e6e20b89ec34b1f41e18311e28d134435ad8b7312f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/sailboat/lod0",
        "model/sailboat/lod1",
        "model/sailboat/lod2"
      ],
      materials: [
        "hull",
        "stripe",
        "antifoul",
        "deck",
        "spar",
        "sail"
      ],
      nodes: [
        "sailboat"
      ],
      note: "waterline at y = 0 (keel and rudder below it); bow on +Z; sails are double-sided",
      sha256: "2f99d688e3b91cf455f640e6e20b89ec34b1f41e18311e28d134435ad8b7312f",
      source: {
        procedural: {
          builder: "sailboat",
          params: {},
          script: "scripts/props.py",
          script_sha256: "36f819f502c05321db5a31b7fb88c7748ace0cfebafba08ad2403f4b8bb2ae57"
        }
      },
      tris: 274
    },
    "model/sea-arch/lod0": {
      bounds_m: [
        [
          -27.545866544581557,
          -2.0000067279073326,
          -10.407886290687271
        ],
        [
          24.70508894447846,
          25.197224650633512,
          10.404775595255467
        ]
      ],
      bytes: 1639088,
      emissive: [],
      file: "4ae1e5e4cfb73a91ce79f74358c21b8edba9778afa88d174cbe54bcb2da2557a.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/sea-arch/lod0",
        "model/sea-arch/lod1",
        "model/sea-arch/lod2"
      ],
      materials: [
        "rock",
        "grass"
      ],
      nodes: [
        null
      ],
      note: "the coast's sea arch, 25 m: a low fluted grey rock span between two thick stacks, a grass cap on its crest; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "4ae1e5e4cfb73a91ce79f74358c21b8edba9778afa88d174cbe54bcb2da2557a",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "4b909df44640deec38fc4b1548f9aeb599a3477adffe6d52a112f9c52e777f2c.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a grey coastal sea arch of fluted weathered rock under a grassy cap",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "sea-arch",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 24e3
    },
    "model/sea-arch/lod1": {
      bounds_m: [
        [
          -27.523972494778498,
          -2.0002551718239396,
          -10.454441472415727
        ],
        [
          24.670049363738148,
          25.176149375108974,
          10.390983372977026
        ]
      ],
      bytes: 523908,
      emissive: [],
      file: "cd52a435d6eb1d0e5b1f7a71f16715ed47eadf4373a030b924f7d441d611360d.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/sea-arch/lod0",
        "model/sea-arch/lod1",
        "model/sea-arch/lod2"
      ],
      materials: [
        "rock",
        "grass"
      ],
      nodes: [
        null
      ],
      note: "the coast's sea arch, 25 m: a low fluted grey rock span between two thick stacks, a grass cap on its crest; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "cd52a435d6eb1d0e5b1f7a71f16715ed47eadf4373a030b924f7d441d611360d",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "fdb60dcd49456053bda1865b30e656659b08906f9e42cc4bc046e96357774278.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a grey coastal sea arch of fluted weathered rock under a grassy cap",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "sea-arch",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 6e3
    },
    "model/sea-arch/lod2": {
      bounds_m: [
        [
          -27.302825552589645,
          -2,
          -10.396171624002935
        ],
        [
          24.55736853644385,
          25.1420481084022,
          10.416303998539094
        ]
      ],
      bytes: 162e3,
      emissive: [],
      file: "387429a6ce7da81195dc7390e61464adfc9c4f1a1f0ff6c0a021da086edfc963.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/sea-arch/lod0",
        "model/sea-arch/lod1",
        "model/sea-arch/lod2"
      ],
      materials: [
        "rock",
        "grass"
      ],
      nodes: [
        null
      ],
      note: "the coast's sea arch, 25 m: a low fluted grey rock span between two thick stacks, a grass cap on its crest; closed solid cut flat at y = -2 m, no UVs and no textures; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, no vertex colour",
      sha256: "387429a6ce7da81195dc7390e61464adfc9c4f1a1f0ff6c0a021da086edfc963",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          from: "8851adcf431c6c276d4bfa0ada7d59e38cec4f9d95b1abec954cb35d5f87918d.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a grey coastal sea arch of fluted weathered rock under a grassy cap",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "1a73700db7694fdbe3b21f5082e97ed78548d5c459027bf70327e4a88a009203",
          seed: 21,
          steps: 32,
          strength: 0.65,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.5708,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.7124,
              0.18
            ],
            [
              0.7854,
              0.75
            ]
          ]
        },
        procedural: {
          builder: "sea-arch",
          params: {},
          script: "props/landmarks.py",
          script_sha256: "1faa8aa220137363fb56fd7e842f2ceeafd0ada02dcaf5280efd79aa1d4565e6"
        }
      },
      tris: 1600
    },
    "model/shrub-b/lod0": {
      bounds_m: [
        [
          -0.918509542273706,
          -0.20289698321387328,
          -0.9570058990420238
        ],
        [
          0.918509542273706,
          1.6401725614020912,
          0.9570058990420238
        ]
      ],
      bytes: 2578692,
      emissive: [],
      file: "aa82f4485149045571fdde06408cc2a984ef3aaf130049ac6b3fe7469bfb4ddd.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/shrub-b/lod0",
        "model/shrub-b/lod1",
        "model/shrub-b/lod2"
      ],
      materials: [
        "foliage"
      ],
      nodes: [
        "shrub-b"
      ],
      note: "temperate shrub, closed blob mound, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "aa82f4485149045571fdde06408cc2a984ef3aaf130049ac6b3fe7469bfb4ddd",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "3986c1c29ca9ae01f55009f7fc1d4fb0e4184b03f84209f01748a71a67c1d724.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a lush rounded green woodland shrub with overlapping painted leaf clusters, warm sunlit highlights and cool blue-green shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "shrub",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            centre: [
              0,
              0.72,
              0
            ],
            colour: "#62b146",
            core: 0.52,
            k: 0.09,
            n: 720,
            rings: [
              [
                6,
                0.5,
                0.42,
                0.38
              ],
              [
                4,
                0.32,
                0.9,
                0.37
              ],
              [
                1,
                0,
                1.2,
                0.46
              ]
            ],
            seed: 41
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run",
        "tulip-gardens"
      ],
      tris: 1946
    },
    "model/shrub-b/lod1": {
      bounds_m: [
        [
          -0.8927712240845713,
          -0.1912646208861703,
          -0.9337218883960485
        ],
        [
          0.9138908505337684,
          1.629366628706385,
          0.9237297336794146
        ]
      ],
      bytes: 2518612,
      emissive: [],
      file: "294c5c092adac83fa8e11efe2bc0ef2f66a122104637a88e6dfcbe649022952d.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/shrub-b/lod0",
        "model/shrub-b/lod1",
        "model/shrub-b/lod2"
      ],
      materials: [
        "foliage"
      ],
      nodes: [
        "shrub-b"
      ],
      note: "temperate shrub, closed blob mound, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "294c5c092adac83fa8e11efe2bc0ef2f66a122104637a88e6dfcbe649022952d",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "600444e4d9d94542fb001a19f787224f5136100c1f720f197e63b9dac1418df7.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a lush rounded green woodland shrub with overlapping painted leaf clusters, warm sunlit highlights and cool blue-green shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "shrub",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            centre: [
              0,
              0.72,
              0
            ],
            colour: "#62b146",
            core: 0.52,
            k: 0.09,
            n: 720,
            rings: [
              [
                6,
                0.5,
                0.42,
                0.38
              ],
              [
                4,
                0.32,
                0.9,
                0.37
              ],
              [
                1,
                0,
                1.2,
                0.46
              ]
            ],
            seed: 41
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run",
        "tulip-gardens"
      ],
      tris: 448
    },
    "model/shrub-b/lod2": {
      bounds_m: [
        [
          -0.8806508931156105,
          -0.18039100317722961,
          -0.9382246428758736
        ],
        [
          0.9063120610991853,
          1.5758536895637523,
          0.8786702651990201
        ]
      ],
      bytes: 2503336,
      emissive: [],
      file: "333f7acce2a7de2a6e72df353cd425521742fad153bdb831c1b4d923449875e8.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/shrub-b/lod0",
        "model/shrub-b/lod1",
        "model/shrub-b/lod2"
      ],
      materials: [
        "foliage"
      ],
      nodes: [
        "shrub-b"
      ],
      note: "temperate shrub, closed blob mound, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "333f7acce2a7de2a6e72df353cd425521742fad153bdb831c1b4d923449875e8",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "e0fa8d0624822f1b0831c5cb63a0c102d08ad98d5d56f4b5ac0ea15df68a385d.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a lush rounded green woodland shrub with overlapping painted leaf clusters, warm sunlit highlights and cool blue-green shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "shrub",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            centre: [
              0,
              0.72,
              0
            ],
            colour: "#62b146",
            core: 0.52,
            k: 0.09,
            n: 720,
            rings: [
              [
                6,
                0.5,
                0.42,
                0.38
              ],
              [
                4,
                0.32,
                0.9,
                0.37
              ],
              [
                1,
                0,
                1.2,
                0.46
              ]
            ],
            seed: 41
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run",
        "tulip-gardens"
      ],
      tris: 108
    },
    "model/shrub-desert/lod0": {
      bounds_m: [
        [
          -0.36553422116350787,
          -0.06337829640679868,
          -0.375169691455971
        ],
        [
          0.36553422116350787,
          0.48977283439963243,
          0.375169691455971
        ]
      ],
      bytes: 2437624,
      emissive: [],
      file: "a526c682883683e06ae39820fd326bf5bcd8d0f8dfc9c1fa294cf982b27d560a.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/shrub-desert/lod0",
        "model/shrub-desert/lod1",
        "model/shrub-desert/lod2"
      ],
      materials: [
        "foliage"
      ],
      nodes: [
        "shrub-desert"
      ],
      note: "low sage-green desert scrub, closed blob mound, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "a526c682883683e06ae39820fd326bf5bcd8d0f8dfc9c1fa294cf982b27d560a",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "7c7dc8b3a9bfadd36d8356f9266a46d88a5aeb78e6ce12f2722b990dda56a789.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a low sage-green desert scrub bush with clustered dry foliage tufts, warm ochre-green highlights and cool violet-grey shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "shrub",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            centre: [
              0,
              0.21,
              0
            ],
            colour: "#a3b072",
            core: 0.24,
            k: 0.05,
            n: 720,
            rings: [
              [
                5,
                0.21,
                0.15,
                0.17
              ],
              [
                2,
                0.1,
                0.33,
                0.17
              ]
            ],
            seed: 47
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway"
      ],
      tris: 1886
    },
    "model/shrub-desert/lod1": {
      bounds_m: [
        [
          -0.3540273630778801,
          -0.06150185963359269,
          -0.3675273910648795
        ],
        [
          0.36266757088338386,
          0.5131943192076053,
          0.37953607020993385
        ]
      ],
      bytes: 2379484,
      emissive: [],
      file: "dc8f9dbc28004b3edea191884461f8dd6d1ce1e72fe089ac5dc1c25850e8783b.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/shrub-desert/lod0",
        "model/shrub-desert/lod1",
        "model/shrub-desert/lod2"
      ],
      materials: [
        "foliage"
      ],
      nodes: [
        "shrub-desert"
      ],
      note: "low sage-green desert scrub, closed blob mound, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "dc8f9dbc28004b3edea191884461f8dd6d1ce1e72fe089ac5dc1c25850e8783b",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "534ada7059ff0332c22266c0311b3747e00b187c708b49cb96a9017216864b6c.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a low sage-green desert scrub bush with clustered dry foliage tufts, warm ochre-green highlights and cool violet-grey shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "shrub",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            centre: [
              0,
              0.21,
              0
            ],
            colour: "#a3b072",
            core: 0.24,
            k: 0.05,
            n: 720,
            rings: [
              [
                5,
                0.21,
                0.15,
                0.17
              ],
              [
                2,
                0.1,
                0.33,
                0.17
              ]
            ],
            seed: 47
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway"
      ],
      tris: 442
    },
    "model/shrub-desert/lod2": {
      bounds_m: [
        [
          -0.36834993601034505,
          -0.052544781905535555,
          -0.37284369913552984
        ],
        [
          0.3639872028359942,
          0.504672152471604,
          0.39737224976691166
        ]
      ],
      bytes: 2364956,
      emissive: [],
      file: "69af3f090fe4ad2d880afa505b1dafcde9af249aca92942738714a4d3e9fd8e3.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/shrub-desert/lod0",
        "model/shrub-desert/lod1",
        "model/shrub-desert/lod2"
      ],
      materials: [
        "foliage"
      ],
      nodes: [
        "shrub-desert"
      ],
      note: "low sage-green desert scrub, closed blob mound, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "69af3f090fe4ad2d880afa505b1dafcde9af249aca92942738714a4d3e9fd8e3",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "d115763787a485623738810d9569915af468c5945dce89523308863cf7f8fb67.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a low sage-green desert scrub bush with clustered dry foliage tufts, warm ochre-green highlights and cool violet-grey shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "shrub",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            centre: [
              0,
              0.21,
              0
            ],
            colour: "#a3b072",
            core: 0.24,
            k: 0.05,
            n: 720,
            rings: [
              [
                5,
                0.21,
                0.15,
                0.17
              ],
              [
                2,
                0.1,
                0.33,
                0.17
              ]
            ],
            seed: 47
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "desert-canyons",
        "sunset-highway"
      ],
      tris: 108
    },
    "model/shrub-tropical/lod0": {
      bounds_m: [
        [
          -0.859831226876455,
          -0.123398892102343,
          -0.8544870087346059
        ],
        [
          0.859831226876455,
          0.9752328317839618,
          0.8544870087346059
        ]
      ],
      bytes: 2700080,
      emissive: [],
      file: "7a6fc84a8f0434ce36eaa25870a3a38aa29a85c2f82208e05dc8ca989ea6f458.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/shrub-tropical/lod0",
        "model/shrub-tropical/lod1",
        "model/shrub-tropical/lod2"
      ],
      materials: [
        "foliage",
        "leaf"
      ],
      nodes: [
        "shrub-tropical"
      ],
      note: "tropical shrub, lobed mound under eight broad arching leaves (LOD2: mound only), closed blob mound, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "7a6fc84a8f0434ce36eaa25870a3a38aa29a85c2f82208e05dc8ca989ea6f458",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "0c183e723f6c9255b515328e4a0aa06906eed895f57f3572e5d7e8bc48319e1a.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a lush tropical green shrub with broad arching palmate leaves and clustered foliage masses, warm sunlit highlights and deep cool shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "shrub",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            centre: [
              0,
              0.5,
              0
            ],
            colour: "#3aa852",
            core: 0.4,
            k: 0.08,
            n: 480,
            rings: [
              [
                5,
                0.38,
                0.32,
                0.31
              ],
              [
                3,
                0.2,
                0.66,
                0.31
              ]
            ],
            seed: 43
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach"
      ],
      tris: 3886
    },
    "model/shrub-tropical/lod1": {
      bounds_m: [
        [
          -0.6643471838172086,
          -0.11483757969683775,
          -0.8123482655764747
        ],
        [
          0.8347226830784268,
          0.9711750814465914,
          0.8795885190541257
        ]
      ],
      bytes: 2532468,
      emissive: [],
      file: "7984d04b72b6d7e662e92d3f67542d1a95bba3cbccffa184392e9b432a273429.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/shrub-tropical/lod0",
        "model/shrub-tropical/lod1",
        "model/shrub-tropical/lod2"
      ],
      materials: [
        "foliage",
        "leaf"
      ],
      nodes: [
        "shrub-tropical"
      ],
      note: "tropical shrub, lobed mound under eight broad arching leaves (LOD2: mound only), closed blob mound, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "7984d04b72b6d7e662e92d3f67542d1a95bba3cbccffa184392e9b432a273429",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "571ab95fad0825f1b4285a029db7be76dfe61072fbbfd1084f438bc762c31b0a.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a lush tropical green shrub with broad arching palmate leaves and clustered foliage masses, warm sunlit highlights and deep cool shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "shrub",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            centre: [
              0,
              0.5,
              0
            ],
            colour: "#3aa852",
            core: 0.4,
            k: 0.08,
            n: 480,
            rings: [
              [
                5,
                0.38,
                0.32,
                0.31
              ],
              [
                3,
                0.2,
                0.66,
                0.31
              ]
            ],
            seed: 43
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach"
      ],
      tris: 504
    },
    "model/shrub-tropical/lod2": {
      bounds_m: [
        [
          -0.5300813516250541,
          -0.11097402948574181,
          -0.6935470778629935
        ],
        [
          0.7808186818072094,
          0.99751710225993,
          0.7188544570206021
        ]
      ],
      bytes: 2509884,
      emissive: [],
      file: "db4765b5ebb9670e85fa001d7520872a0949246deae70855521311e0f0a8f984.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/shrub-tropical/lod0",
        "model/shrub-tropical/lod1",
        "model/shrub-tropical/lod2"
      ],
      materials: [
        "foliage"
      ],
      nodes: [
        "shrub-tropical"
      ],
      note: "tropical shrub, lobed mound under eight broad arching leaves (LOD2: mound only), closed blob mound, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "db4765b5ebb9670e85fa001d7520872a0949246deae70855521311e0f0a8f984",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "408da9784064600872e8a587dc91ea474ff9ac3080084d47efcdb55a63ccd92b.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a lush tropical green shrub with broad arching palmate leaves and clustered foliage masses, warm sunlit highlights and deep cool shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "shrub",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            centre: [
              0,
              0.5,
              0
            ],
            colour: "#3aa852",
            core: 0.4,
            k: 0.08,
            n: 480,
            rings: [
              [
                5,
                0.38,
                0.32,
                0.31
              ],
              [
                3,
                0.2,
                0.66,
                0.31
              ]
            ],
            seed: 43
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "coconut-beach"
      ],
      tris: 108
    },
    "model/street-lamp/lod0": {
      bounds_m: [
        [
          -0.24,
          0,
          -0.24
        ],
        [
          2.5827215073168333,
          8.222229624757455,
          0.24
        ]
      ],
      bytes: 15568,
      emissive: [
        "lamp"
      ],
      file: "b4b8d7d8ad8a2d716d6781e34a88d8c5e334158e1a12ca97715dde1d48b542f9.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/street-lamp/lod0",
        "model/street-lamp/lod1",
        "model/street-lamp/lod2"
      ],
      materials: [
        "metal",
        "trim",
        "lamp"
      ],
      nodes: [
        "street-lamp"
      ],
      note: "pole axis at the origin; the arm and head overhang +X (lamp centre at x 2.15 m, 8.06 m up): yaw the lamp so +X points over the road",
      sha256: "b4b8d7d8ad8a2d716d6781e34a88d8c5e334158e1a12ca97715dde1d48b542f9",
      source: {
        procedural: {
          builder: "street_lamp",
          params: {},
          script: "scripts/props.py",
          script_sha256: "36f819f502c05321db5a31b7fb88c7748ace0cfebafba08ad2403f4b8bb2ae57"
        }
      },
      tris: 446
    },
    "model/street-lamp/lod1": {
      bounds_m: [
        [
          -0.22825356391083687,
          0,
          -0.24
        ],
        [
          2.5827215073168333,
          8.222229624757455,
          0.24
        ]
      ],
      bytes: 11224,
      emissive: [
        "lamp"
      ],
      file: "2327b8bee740b23f3e885944e8e6b5e34ec098f14c73d7b500385141d56aa9e2.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/street-lamp/lod0",
        "model/street-lamp/lod1",
        "model/street-lamp/lod2"
      ],
      materials: [
        "metal",
        "lamp"
      ],
      nodes: [
        "street-lamp"
      ],
      note: "pole axis at the origin; the arm and head overhang +X (lamp centre at x 2.15 m, 8.06 m up): yaw the lamp so +X points over the road",
      sha256: "2327b8bee740b23f3e885944e8e6b5e34ec098f14c73d7b500385141d56aa9e2",
      source: {
        procedural: {
          builder: "street_lamp",
          params: {},
          script: "scripts/props.py",
          script_sha256: "36f819f502c05321db5a31b7fb88c7748ace0cfebafba08ad2403f4b8bb2ae57"
        }
      },
      tris: 198
    },
    "model/street-lamp/lod2": {
      bounds_m: [
        [
          -0.20784609690826525,
          0,
          -0.24
        ],
        [
          2.5827215073168333,
          8.267058386171584,
          0.24
        ]
      ],
      bytes: 6616,
      emissive: [
        "lamp"
      ],
      file: "ff51aaf97b75ef1b1d658bbf138d125195f0edeb289a21274b3f20ceb3910eb8.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/street-lamp/lod0",
        "model/street-lamp/lod1",
        "model/street-lamp/lod2"
      ],
      materials: [
        "metal",
        "lamp"
      ],
      nodes: [
        "street-lamp"
      ],
      note: "pole axis at the origin; the arm and head overhang +X (lamp centre at x 2.15 m, 8.06 m up): yaw the lamp so +X points over the road",
      sha256: "ff51aaf97b75ef1b1d658bbf138d125195f0edeb289a21274b3f20ceb3910eb8",
      source: {
        procedural: {
          builder: "street_lamp",
          params: {},
          script: "scripts/props.py",
          script_sha256: "36f819f502c05321db5a31b7fb88c7748ace0cfebafba08ad2403f4b8bb2ae57"
        }
      },
      tris: 98
    },
    "model/stump/lod0": {
      bounds_m: [
        [
          -0.7127752304077148,
          0,
          -0.7951571643352509
        ],
        [
          0.7127752304077148,
          0.5726675391197205,
          0.7951571643352509
        ]
      ],
      build: {
        budget: 6e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 1131068,
      file: "ef35a40f509af37aa4539f109510a2b08fae4d961f3b0f9b9424017946bbe7b6.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/stump/lod0",
        "model/stump/lod1",
        "model/stump/lod2"
      ],
      sha256: "ef35a40f509af37aa4539f109510a2b08fae4d961f3b0f9b9424017946bbe7b6",
      source: {
        polyhaven: {
          id: "tree_stump_01",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/tree_stump_01/tree_stump_01_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 41046
      },
      stages: [
        "wilderness-run",
        "alpine-peaks"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 1024
      },
      tris: 5998
    },
    "model/stump/lod1": {
      bounds_m: [
        [
          -0.7127752304077148,
          0,
          -0.7951571643352509
        ],
        [
          0.7127752304077148,
          0.5726675391197205,
          0.7951571643352509
        ]
      ],
      build: {
        budget: 6e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 332120,
      file: "ea87fe6ea0ea6d36f2f1d6e0c843384a2d4edb568af643be118c6c5238e81d79.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/stump/lod0",
        "model/stump/lod1",
        "model/stump/lod2"
      ],
      sha256: "ea87fe6ea0ea6d36f2f1d6e0c843384a2d4edb568af643be118c6c5238e81d79",
      source: {
        polyhaven: {
          id: "tree_stump_01",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/tree_stump_01/tree_stump_01_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 41046
      },
      stages: [
        "wilderness-run",
        "alpine-peaks"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 512
      },
      tris: 1499
    },
    "model/stump/lod2": {
      bounds_m: [
        [
          -0.7127752304077148,
          0,
          -0.7951571643352509
        ],
        [
          0.7127752304077148,
          0.5726675391197205,
          0.7951571643352509
        ]
      ],
      build: {
        budget: 6e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 51044,
      file: "151de1a5a42759a09b15046285c42f35fb69ced1134907519f3ec7dde1d6023d.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/stump/lod0",
        "model/stump/lod1",
        "model/stump/lod2"
      ],
      sha256: "151de1a5a42759a09b15046285c42f35fb69ced1134907519f3ec7dde1d6023d",
      source: {
        polyhaven: {
          id: "tree_stump_01",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/tree_stump_01/tree_stump_01_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 41046
      },
      stages: [
        "wilderness-run",
        "alpine-peaks"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 256
      },
      tris: 360
    },
    "model/tower-a/lod0": {
      bounds_m: [
        [
          -14.2,
          0,
          -14.2
        ],
        [
          14.2,
          80,
          14.2
        ]
      ],
      bytes: 55392,
      emissive: [
        "window"
      ],
      file: "f74702f7238934d89e4c588621fa85eb3dcdfffd6e1edab2ad1be554f8343e84.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tower-a/lod0",
        "model/tower-a/lod1",
        "model/tower-a/lod2"
      ],
      materials: [
        "facade",
        "window",
        "trim"
      ],
      nodes: [
        "tower-a"
      ],
      note: "art-deco setbacks, stepped crown and spire, 80 m. `window` is emissive (lit cells from its emissive texture, 16x16 cells of one bay x one floor, 1.6 x 3.6 m); `facade` body; `trim` dark metal. Row 0 of the texture is all lit (crown bands).",
      sha256: "f74702f7238934d89e4c588621fa85eb3dcdfffd6e1edab2ad1be554f8343e84",
      source: {
        procedural: {
          builder: "tower_a",
          params: {},
          script: "scripts/towers.py",
          script_sha256: "57d83316163f174a1af99dbe0ede50d337a808a6ab1adfc94ef6eb91f7cd1ebb"
        }
      },
      tris: 836
    },
    "model/tower-a/lod1": {
      bounds_m: [
        [
          -14.2,
          0,
          -14.2
        ],
        [
          14.2,
          80,
          14.2
        ]
      ],
      bytes: 24776,
      emissive: [
        "window"
      ],
      file: "72e9b388011cbcaf0a03c33e2a40ba046df3aa696eda3f9e102eecf4e3591dc6.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tower-a/lod0",
        "model/tower-a/lod1",
        "model/tower-a/lod2"
      ],
      materials: [
        "facade",
        "window",
        "trim"
      ],
      nodes: [
        "tower-a"
      ],
      note: "art-deco setbacks, stepped crown and spire, 80 m. `window` is emissive (lit cells from its emissive texture, 16x16 cells of one bay x one floor, 1.6 x 3.6 m); `facade` body; `trim` dark metal. Row 0 of the texture is all lit (crown bands).",
      sha256: "72e9b388011cbcaf0a03c33e2a40ba046df3aa696eda3f9e102eecf4e3591dc6",
      source: {
        procedural: {
          builder: "tower_a",
          params: {},
          script: "scripts/towers.py",
          script_sha256: "57d83316163f174a1af99dbe0ede50d337a808a6ab1adfc94ef6eb91f7cd1ebb"
        }
      },
      tris: 268
    },
    "model/tower-a/lod2": {
      bounds_m: [
        [
          -14.2,
          0,
          -14.2
        ],
        [
          14.2,
          80,
          14.2
        ]
      ],
      bytes: 23036,
      emissive: [
        "window"
      ],
      file: "9fd9ae9e57f605803ed1a6748a8b0b9b72bfd6315da99161d83211b1015461d8.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tower-a/lod0",
        "model/tower-a/lod1",
        "model/tower-a/lod2"
      ],
      materials: [
        "facade",
        "window",
        "trim"
      ],
      nodes: [
        "tower-a"
      ],
      note: "art-deco setbacks, stepped crown and spire, 80 m. `window` is emissive (lit cells from its emissive texture, 16x16 cells of one bay x one floor, 1.6 x 3.6 m); `facade` body; `trim` dark metal. Row 0 of the texture is all lit (crown bands).",
      sha256: "9fd9ae9e57f605803ed1a6748a8b0b9b72bfd6315da99161d83211b1015461d8",
      source: {
        procedural: {
          builder: "tower_a",
          params: {},
          script: "scripts/towers.py",
          script_sha256: "57d83316163f174a1af99dbe0ede50d337a808a6ab1adfc94ef6eb91f7cd1ebb"
        }
      },
      tris: 236
    },
    "model/tower-b/lod0": {
      bounds_m: [
        [
          -20.3,
          0,
          -7.3
        ],
        [
          20.3,
          57.8,
          7.3
        ]
      ],
      bytes: 39756,
      emissive: [
        "window"
      ],
      file: "c24adebafc173ed6130709380e0d3cdccb6831169279570c7b687ded6c3656a7.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tower-b/lod0",
        "model/tower-b/lod1",
        "model/tower-b/lod2"
      ],
      materials: [
        "facade",
        "window",
        "trim"
      ],
      nodes: [
        "tower-b"
      ],
      note: "curtain-wall slab, 57.8 m. `window` is emissive (lit cells from its emissive texture, 16x16 cells of one bay x one floor, 1.6 x 3.6 m); `facade` body; `trim` dark metal. Row 0 of the texture is all lit (crown bands).",
      sha256: "c24adebafc173ed6130709380e0d3cdccb6831169279570c7b687ded6c3656a7",
      source: {
        procedural: {
          builder: "tower_b",
          params: {},
          script: "scripts/towers.py",
          script_sha256: "57d83316163f174a1af99dbe0ede50d337a808a6ab1adfc94ef6eb91f7cd1ebb"
        }
      },
      tris: 572
    },
    "model/tower-b/lod1": {
      bounds_m: [
        [
          -20.3,
          0,
          -7.3
        ],
        [
          20.3,
          57,
          7.3
        ]
      ],
      bytes: 17848,
      emissive: [
        "window"
      ],
      file: "1ff7665522ee526f3dc12876ba94ed7c6465edbf018934a2b1c00f2b37048085.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tower-b/lod0",
        "model/tower-b/lod1",
        "model/tower-b/lod2"
      ],
      materials: [
        "facade",
        "window",
        "trim"
      ],
      nodes: [
        "tower-b"
      ],
      note: "curtain-wall slab, 57.8 m. `window` is emissive (lit cells from its emissive texture, 16x16 cells of one bay x one floor, 1.6 x 3.6 m); `facade` body; `trim` dark metal. Row 0 of the texture is all lit (crown bands).",
      sha256: "1ff7665522ee526f3dc12876ba94ed7c6465edbf018934a2b1c00f2b37048085",
      source: {
        procedural: {
          builder: "tower_b",
          params: {},
          script: "scripts/towers.py",
          script_sha256: "57d83316163f174a1af99dbe0ede50d337a808a6ab1adfc94ef6eb91f7cd1ebb"
        }
      },
      tris: 156
    },
    "model/tower-b/lod2": {
      bounds_m: [
        [
          -20.3,
          0,
          -7.3
        ],
        [
          20.3,
          53,
          7.3
        ]
      ],
      bytes: 11972,
      emissive: [
        "window"
      ],
      file: "1ce878bbf2c87067d9aa7e477278f7d1949948196865b2e5d53ec3ea0b002389.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tower-b/lod0",
        "model/tower-b/lod1",
        "model/tower-b/lod2"
      ],
      materials: [
        "facade",
        "window"
      ],
      nodes: [
        "tower-b"
      ],
      note: "curtain-wall slab, 57.8 m. `window` is emissive (lit cells from its emissive texture, 16x16 cells of one bay x one floor, 1.6 x 3.6 m); `facade` body; `trim` dark metal. Row 0 of the texture is all lit (crown bands).",
      sha256: "1ce878bbf2c87067d9aa7e477278f7d1949948196865b2e5d53ec3ea0b002389",
      source: {
        procedural: {
          builder: "tower_b",
          params: {},
          script: "scripts/towers.py",
          script_sha256: "57d83316163f174a1af99dbe0ede50d337a808a6ab1adfc94ef6eb91f7cd1ebb"
        }
      },
      tris: 60
    },
    "model/tower-c/lod0": {
      bounds_m: [
        [
          -9.540000000000001,
          0,
          -9.540000000000001
        ],
        [
          9.540000000000001,
          46,
          9.540000000000001
        ]
      ],
      bytes: 27384,
      emissive: [
        "window"
      ],
      file: "fd3b30fb75291c767928a28a01730b63347393cbb2caa3ec754b127c5b5c976a.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tower-c/lod0",
        "model/tower-c/lod1",
        "model/tower-c/lod2"
      ],
      materials: [
        "facade",
        "window",
        "trim"
      ],
      nodes: [
        "tower-c"
      ],
      note: "octagonal tower with a lit crown band and antenna, 46 m. `window` is emissive (lit cells from its emissive texture, 16x16 cells of one bay x one floor, 1.6 x 3.6 m); `facade` body; `trim` dark metal. Row 0 of the texture is all lit (crown bands).",
      sha256: "fd3b30fb75291c767928a28a01730b63347393cbb2caa3ec754b127c5b5c976a",
      source: {
        procedural: {
          builder: "tower_c",
          params: {},
          script: "scripts/towers.py",
          script_sha256: "57d83316163f174a1af99dbe0ede50d337a808a6ab1adfc94ef6eb91f7cd1ebb"
        }
      },
      tris: 360
    },
    "model/tower-c/lod1": {
      bounds_m: [
        [
          -9.540000000000001,
          0,
          -9.540000000000001
        ],
        [
          9.540000000000001,
          46,
          9.540000000000001
        ]
      ],
      bytes: 21664,
      emissive: [
        "window"
      ],
      file: "747af978e97ffe68cf8d08d238a15ef09e562b547d30f9a07f120c31644deff6.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tower-c/lod0",
        "model/tower-c/lod1",
        "model/tower-c/lod2"
      ],
      materials: [
        "facade",
        "window",
        "trim"
      ],
      nodes: [
        "tower-c"
      ],
      note: "octagonal tower with a lit crown band and antenna, 46 m. `window` is emissive (lit cells from its emissive texture, 16x16 cells of one bay x one floor, 1.6 x 3.6 m); `facade` body; `trim` dark metal. Row 0 of the texture is all lit (crown bands).",
      sha256: "747af978e97ffe68cf8d08d238a15ef09e562b547d30f9a07f120c31644deff6",
      source: {
        procedural: {
          builder: "tower_c",
          params: {},
          script: "scripts/towers.py",
          script_sha256: "57d83316163f174a1af99dbe0ede50d337a808a6ab1adfc94ef6eb91f7cd1ebb"
        }
      },
      tris: 240
    },
    "model/tower-c/lod2": {
      bounds_m: [
        [
          -9.540000000000001,
          0,
          -9.540000000000001
        ],
        [
          9.540000000000001,
          46,
          9.540000000000001
        ]
      ],
      bytes: 19908,
      emissive: [
        "window"
      ],
      file: "186d7e449a7b75f08d301e3cb4cb7409fb41f53a2a41b280623ca677779462ff.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tower-c/lod0",
        "model/tower-c/lod1",
        "model/tower-c/lod2"
      ],
      materials: [
        "facade",
        "window",
        "trim"
      ],
      nodes: [
        "tower-c"
      ],
      note: "octagonal tower with a lit crown band and antenna, 46 m. `window` is emissive (lit cells from its emissive texture, 16x16 cells of one bay x one floor, 1.6 x 3.6 m); `facade` body; `trim` dark metal. Row 0 of the texture is all lit (crown bands).",
      sha256: "186d7e449a7b75f08d301e3cb4cb7409fb41f53a2a41b280623ca677779462ff",
      source: {
        procedural: {
          builder: "tower_c",
          params: {},
          script: "scripts/towers.py",
          script_sha256: "57d83316163f174a1af99dbe0ede50d337a808a6ab1adfc94ef6eb91f7cd1ebb"
        }
      },
      tris: 204
    },
    "model/trash-can/lod0": {
      bounds_m: [
        [
          -0.32552472905354807,
          0,
          -0.276184543967247
        ],
        [
          0.3255247290535481,
          0.9061599323104019,
          0.276184543967247
        ]
      ],
      build: {
        budget: 3e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: [
          "metal_trash_can",
          "metal_trash_can_handle_left",
          "metal_trash_can_handle_right"
        ],
        origin: "bbox"
      },
      bytes: 239044,
      file: "226e9e5a733f07c0db7f0b251acfd95b8e5a0432c4a493e2545f193a2889268f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/trash-can/lod0",
        "model/trash-can/lod1",
        "model/trash-can/lod2"
      ],
      sha256: "226e9e5a733f07c0db7f0b251acfd95b8e5a0432c4a493e2545f193a2889268f",
      source: {
        polyhaven: {
          id: "metal_trash_can",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/metal_trash_can/metal_trash_can_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 4880
      },
      stages: [
        "metropolis-night"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 512
      },
      tris: 3005
    },
    "model/trash-can/lod1": {
      bounds_m: [
        [
          -0.32552472905354807,
          0,
          -0.276184543967247
        ],
        [
          0.3255247290535481,
          0.9061599323104019,
          0.276184543967247
        ]
      ],
      build: {
        budget: 3e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: [
          "metal_trash_can",
          "metal_trash_can_handle_left",
          "metal_trash_can_handle_right"
        ],
        origin: "bbox"
      },
      bytes: 76588,
      file: "bb3b7e52a48983f7a594c26cde4f25e4e3bb31acfe8797546e1211a8a00212a9.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/trash-can/lod0",
        "model/trash-can/lod1",
        "model/trash-can/lod2"
      ],
      sha256: "bb3b7e52a48983f7a594c26cde4f25e4e3bb31acfe8797546e1211a8a00212a9",
      source: {
        polyhaven: {
          id: "metal_trash_can",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/metal_trash_can/metal_trash_can_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 4880
      },
      stages: [
        "metropolis-night"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 256
      },
      tris: 782
    },
    "model/trash-can/lod2": {
      bounds_m: [
        [
          -0.32552472905354807,
          0,
          -0.276184543967247
        ],
        [
          0.3255247290535481,
          0.9061599323104019,
          0.276184543967247
        ]
      ],
      build: {
        budget: 3e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: [
          "metal_trash_can",
          "metal_trash_can_handle_left",
          "metal_trash_can_handle_right"
        ],
        origin: "bbox"
      },
      bytes: 18868,
      file: "efb2404a406839262696389b4b5d09692346b470f3c4845aba983d988a99f118.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/trash-can/lod0",
        "model/trash-can/lod1",
        "model/trash-can/lod2"
      ],
      sha256: "efb2404a406839262696389b4b5d09692346b470f3c4845aba983d988a99f118",
      source: {
        polyhaven: {
          id: "metal_trash_can",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/metal_trash_can/metal_trash_can_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 4880
      },
      stages: [
        "metropolis-night"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 128
      },
      tris: 220
    },
    "model/tree-broadleaf-a/lod0": {
      bounds_m: [
        [
          -2.1589941863237936,
          -0.09012121377407134,
          -2.1974584443904175
        ],
        [
          2.2433667663752477,
          4.77273604472056,
          2.1661227010684043
        ]
      ],
      bytes: 835724,
      emissive: [],
      file: "0f5a222952e583f1f2536a60c928d08a9de6611c035fd5a4d3f3df67778d800c.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-broadleaf-a/lod0",
        "model/tree-broadleaf-a/lod1",
        "model/tree-broadleaf-a/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-broadleaf-a"
      ],
      note: "deciduous tree, one closed canopy of smooth-blended puffs (soft crevices carry the AO), painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "0f5a222952e583f1f2536a60c928d08a9de6611c035fd5a4d3f3df67778d800c",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "e8a930d26d03656c9115805f345af0543a49553fc08297f67eb6cf46d80fe6ec.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a broadleaf tree with a rounded crown of clustered leaf masses, warm lit greens and cool shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "broadleaf",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            branches: [
              [
                [
                  0,
                  1.9,
                  0
                ],
                [
                  0.9,
                  2.7,
                  0.5
                ]
              ],
              [
                [
                  0,
                  2.1,
                  0
                ],
                [
                  -0.8,
                  2.8,
                  -0.6
                ]
              ],
              [
                [
                  0,
                  2.2,
                  0
                ],
                [
                  0.2,
                  3,
                  -0.9
                ]
              ]
            ],
            centre: [
              0,
              3.2,
              0
            ],
            colour: "#72bd3f",
            core: 1.45,
            k: 0.16,
            puffs: 18,
            r: [
              0.58,
              0.78
            ],
            seed: 21,
            shell: [
              1.55,
              1.05,
              1.55
            ],
            trunk: [
              [
                0,
                0,
                0
              ],
              [
                0.05,
                1,
                0
              ],
              [
                -0.08,
                1.9,
                0.05
              ],
              [
                0,
                2.9,
                0
              ]
            ]
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run"
      ],
      tris: 4302
    },
    "model/tree-broadleaf-a/lod1": {
      bounds_m: [
        [
          -2.1052901839166895,
          -0.08524667424171672,
          -2.156755820606336
        ],
        [
          2.2177879400084386,
          4.8065419112782255,
          2.1522124082793685
        ]
      ],
      bytes: 285472,
      emissive: [],
      file: "c6a675108a3cded25251f86533440fd2c2761a7c8e1445735b0f75d06d5d62d1.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-broadleaf-a/lod0",
        "model/tree-broadleaf-a/lod1",
        "model/tree-broadleaf-a/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-broadleaf-a"
      ],
      note: "deciduous tree, one closed canopy of smooth-blended puffs (soft crevices carry the AO), painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "c6a675108a3cded25251f86533440fd2c2761a7c8e1445735b0f75d06d5d62d1",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "37e95be8cfacab3d105ba26a99038cece4ef0d13954dca868a58c639e0ebb278.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a broadleaf tree with a rounded crown of clustered leaf masses, warm lit greens and cool shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "broadleaf",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            branches: [
              [
                [
                  0,
                  1.9,
                  0
                ],
                [
                  0.9,
                  2.7,
                  0.5
                ]
              ],
              [
                [
                  0,
                  2.1,
                  0
                ],
                [
                  -0.8,
                  2.8,
                  -0.6
                ]
              ],
              [
                [
                  0,
                  2.2,
                  0
                ],
                [
                  0.2,
                  3,
                  -0.9
                ]
              ]
            ],
            centre: [
              0,
              3.2,
              0
            ],
            colour: "#72bd3f",
            core: 1.45,
            k: 0.16,
            puffs: 18,
            r: [
              0.58,
              0.78
            ],
            seed: 21,
            shell: [
              1.55,
              1.05,
              1.55
            ],
            trunk: [
              [
                0,
                0,
                0
              ],
              [
                0.05,
                1,
                0
              ],
              [
                -0.08,
                1.9,
                0.05
              ],
              [
                0,
                2.9,
                0
              ]
            ]
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run"
      ],
      tris: 1178
    },
    "model/tree-broadleaf-a/lod2": {
      bounds_m: [
        [
          -2.0290126558333363,
          -0.0841962268049103,
          -2.09260411765053
        ],
        [
          2.230314060977145,
          4.746909263418909,
          2.1443963375472075
        ]
      ],
      bytes: 84784,
      emissive: [],
      file: "3f80f696befc0fb903cba45ff3e25e40bb2caedd013003133c186b5a4c69edbf.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-broadleaf-a/lod0",
        "model/tree-broadleaf-a/lod1",
        "model/tree-broadleaf-a/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-broadleaf-a"
      ],
      note: "deciduous tree, one closed canopy of smooth-blended puffs (soft crevices carry the AO), painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "3f80f696befc0fb903cba45ff3e25e40bb2caedd013003133c186b5a4c69edbf",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "bdcbf12494891cc4b318a7b58eb2e58d2b5dbc05d62207dd03209988409b0c3b.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a broadleaf tree with a rounded crown of clustered leaf masses, warm lit greens and cool shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "broadleaf",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            branches: [
              [
                [
                  0,
                  1.9,
                  0
                ],
                [
                  0.9,
                  2.7,
                  0.5
                ]
              ],
              [
                [
                  0,
                  2.1,
                  0
                ],
                [
                  -0.8,
                  2.8,
                  -0.6
                ]
              ],
              [
                [
                  0,
                  2.2,
                  0
                ],
                [
                  0.2,
                  3,
                  -0.9
                ]
              ]
            ],
            centre: [
              0,
              3.2,
              0
            ],
            colour: "#72bd3f",
            core: 1.45,
            k: 0.16,
            puffs: 18,
            r: [
              0.58,
              0.78
            ],
            seed: 21,
            shell: [
              1.55,
              1.05,
              1.55
            ],
            trunk: [
              [
                0,
                0,
                0
              ],
              [
                0.05,
                1,
                0
              ],
              [
                -0.08,
                1.9,
                0.05
              ],
              [
                0,
                2.9,
                0
              ]
            ]
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run"
      ],
      tris: 296
    },
    "model/tree-broadleaf-b/lod0": {
      bounds_m: [
        [
          -1.4693183455847736,
          -0.14189232996695894,
          -1.2886240364658408
        ],
        [
          1.8110248612015782,
          4.557251674398841,
          2.7360552344632034
        ]
      ],
      bytes: 796280,
      emissive: [],
      file: "dc67be6880cfe8994e7f95cbe63610b6b5a0add98f513cdf448ed501a54612e5.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-broadleaf-b/lod0",
        "model/tree-broadleaf-b/lod1",
        "model/tree-broadleaf-b/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-broadleaf-b"
      ],
      note: "deciduous tree, one closed canopy of smooth-blended puffs (soft crevices carry the AO), painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "dc67be6880cfe8994e7f95cbe63610b6b5a0add98f513cdf448ed501a54612e5",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "caf35df2b596516948e7335e2c03bea412322ee71f777f37af009da5b5871ae5.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a broadleaf tree with a rounded crown of clustered leaf masses, warm lit greens and cool shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "broadleaf",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            branches: [
              [
                [
                  0.08,
                  1.5,
                  0.45
                ],
                [
                  0.75,
                  2.3,
                  0.9
                ]
              ],
              [
                [
                  0.1,
                  1.6,
                  0.5
                ],
                [
                  -0.5,
                  2.4,
                  1.5
                ]
              ]
            ],
            centre: [
              0.15,
              2.95,
              0.75
            ],
            colour: "#62b043",
            core: 1.15,
            k: 0.15,
            puffs: 16,
            r: [
              0.5,
              0.68
            ],
            seed: 29,
            shell: [
              1,
              1.05,
              1.45
            ],
            trunk: [
              [
                0,
                0,
                0
              ],
              [
                0,
                0.9,
                0.15
              ],
              [
                0.12,
                1.6,
                0.55
              ],
              [
                0.15,
                2.5,
                0.75
              ]
            ]
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run",
        "tulip-gardens"
      ],
      tris: 4190
    },
    "model/tree-broadleaf-b/lod1": {
      bounds_m: [
        [
          -1.464590133844407,
          -0.15334565983204257,
          -1.260171200171732
        ],
        [
          1.8181400157043766,
          4.518060427983398,
          2.707527119679642
        ]
      ],
      bytes: 281568,
      emissive: [],
      file: "acdfbfb447c9b1ad95073e5a19e72d0bc9687d34034d83eb2da38e11bcd6715b.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-broadleaf-b/lod0",
        "model/tree-broadleaf-b/lod1",
        "model/tree-broadleaf-b/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-broadleaf-b"
      ],
      note: "deciduous tree, one closed canopy of smooth-blended puffs (soft crevices carry the AO), painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "acdfbfb447c9b1ad95073e5a19e72d0bc9687d34034d83eb2da38e11bcd6715b",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "7892eb83de11002ad26cca4f4341cbb41b07ddaf00eccced085979588f2495e7.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a broadleaf tree with a rounded crown of clustered leaf masses, warm lit greens and cool shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "broadleaf",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            branches: [
              [
                [
                  0.08,
                  1.5,
                  0.45
                ],
                [
                  0.75,
                  2.3,
                  0.9
                ]
              ],
              [
                [
                  0.1,
                  1.6,
                  0.5
                ],
                [
                  -0.5,
                  2.4,
                  1.5
                ]
              ]
            ],
            centre: [
              0.15,
              2.95,
              0.75
            ],
            colour: "#62b043",
            core: 1.15,
            k: 0.15,
            puffs: 16,
            r: [
              0.5,
              0.68
            ],
            seed: 29,
            shell: [
              1,
              1.05,
              1.45
            ],
            trunk: [
              [
                0,
                0,
                0
              ],
              [
                0,
                0.9,
                0.15
              ],
              [
                0.12,
                1.6,
                0.55
              ],
              [
                0.15,
                2.5,
                0.75
              ]
            ]
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run",
        "tulip-gardens"
      ],
      tris: 1118
    },
    "model/tree-broadleaf-b/lod2": {
      bounds_m: [
        [
          -1.3811225581619244,
          -0.1686437347943198,
          -1.2797613751957575
        ],
        [
          1.7544168393173687,
          4.463429916931515,
          2.63051464331668
        ]
      ],
      bytes: 86116,
      emissive: [],
      file: "c50b516d39a3c0e48b04ad8fc828a1c1e4aee075741c522c62b6e7e3888b80a5.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-broadleaf-b/lod0",
        "model/tree-broadleaf-b/lod1",
        "model/tree-broadleaf-b/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-broadleaf-b"
      ],
      note: "deciduous tree, one closed canopy of smooth-blended puffs (soft crevices carry the AO), painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "c50b516d39a3c0e48b04ad8fc828a1c1e4aee075741c522c62b6e7e3888b80a5",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "ccbbe685243c7b17910aa76c4b466288f889284b1c192f16387af604b3c2be6a.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a broadleaf tree with a rounded crown of clustered leaf masses, warm lit greens and cool shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "broadleaf",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            branches: [
              [
                [
                  0.08,
                  1.5,
                  0.45
                ],
                [
                  0.75,
                  2.3,
                  0.9
                ]
              ],
              [
                [
                  0.1,
                  1.6,
                  0.5
                ],
                [
                  -0.5,
                  2.4,
                  1.5
                ]
              ]
            ],
            centre: [
              0.15,
              2.95,
              0.75
            ],
            colour: "#62b043",
            core: 1.15,
            k: 0.15,
            puffs: 16,
            r: [
              0.5,
              0.68
            ],
            seed: 29,
            shell: [
              1,
              1.05,
              1.45
            ],
            trunk: [
              [
                0,
                0,
                0
              ],
              [
                0,
                0.9,
                0.15
              ],
              [
                0.12,
                1.6,
                0.55
              ],
              [
                0.15,
                2.5,
                0.75
              ]
            ]
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "wilderness-run",
        "tulip-gardens"
      ],
      tris: 296
    },
    "model/tree-fir-a/lod0": {
      bounds_m: [
        [
          -3.2048887726211213,
          -0.06,
          -3.1777902081767713
        ],
        [
          3.124981370045411,
          18.814823821423747,
          3.3107384885283437
        ]
      ],
      bytes: 2736880,
      emissive: [],
      file: "ffbadcde57391c1726f5f64147b396713b5fb51b42ed66e6eb6aa3e3b1b35e14.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-fir-a/lod0",
        "model/tree-fir-a/lod1",
        "model/tree-fir-a/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-fir-a"
      ],
      note: "alpine conifer, 7 rounded tiers (LOD2: 2), closed shells, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "ffbadcde57391c1726f5f64147b396713b5fb51b42ed66e6eb6aa3e3b1b35e14",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "8a04e2363444f393071e9eba3c969312e3939f9de601617cd8bb0bff2aa30705.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall dark green fir tree in layered tiers of needles, warm lit edges, blue-green shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "conifer",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            H: 18.9,
            W: 3,
            colour: "#2f7d48",
            h0: 1.3,
            lobes: [
              9,
              8,
              8,
              7,
              7,
              6,
              5
            ],
            seed: 3,
            tiers: 7,
            trunk_r: 0.32
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "alpine-peaks"
      ],
      tris: 8506
    },
    "model/tree-fir-a/lod1": {
      bounds_m: [
        [
          -2.9230020681910536,
          -0.06,
          -2.816089406644276
        ],
        [
          2.9378904167809097,
          18.907781129756525,
          2.963953191136342
        ]
      ],
      bytes: 2473036,
      emissive: [],
      file: "157abb88e46fc35fb1d09b566061f5d0adc76907c9a0b882bb4a77f0c2a8c998.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-fir-a/lod0",
        "model/tree-fir-a/lod1",
        "model/tree-fir-a/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-fir-a"
      ],
      note: "alpine conifer, 7 rounded tiers (LOD2: 2), closed shells, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "157abb88e46fc35fb1d09b566061f5d0adc76907c9a0b882bb4a77f0c2a8c998",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "90b83d5bb0f2db0508e12da3e9329bc9149fc150fde86988a31e8c4f4b5a9fdb.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall dark green fir tree in layered tiers of needles, warm lit edges, blue-green shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "conifer",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            H: 18.9,
            W: 3,
            colour: "#2f7d48",
            h0: 1.3,
            lobes: [
              9,
              8,
              8,
              7,
              7,
              6,
              5
            ],
            seed: 3,
            tiers: 7,
            trunk_r: 0.32
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "alpine-peaks"
      ],
      tris: 2004
    },
    "model/tree-fir-a/lod2": {
      bounds_m: [
        [
          -3.1139634086684547,
          -0.06,
          -2.7282882948918608
        ],
        [
          2.815650918008406,
          18.89877638745616,
          3.090190210365625
        ]
      ],
      bytes: 2395160,
      emissive: [],
      file: "438b767072384a5760383cabb43c1143bf921c05327a69857b1dbe98d42b05c8.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-fir-a/lod0",
        "model/tree-fir-a/lod1",
        "model/tree-fir-a/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-fir-a"
      ],
      note: "alpine conifer, 7 rounded tiers (LOD2: 2), closed shells, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "438b767072384a5760383cabb43c1143bf921c05327a69857b1dbe98d42b05c8",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "94647490922990fc1dbde03956d754146193155ca31da81afb797ec723eab926.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall dark green fir tree in layered tiers of needles, warm lit edges, blue-green shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "conifer",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            H: 18.9,
            W: 3,
            colour: "#2f7d48",
            h0: 1.3,
            lobes: [
              9,
              8,
              8,
              7,
              7,
              6,
              5
            ],
            seed: 3,
            tiers: 7,
            trunk_r: 0.32
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "alpine-peaks"
      ],
      tris: 280
    },
    "model/tree-fir-b/lod0": {
      bounds_m: [
        [
          -2.8876386978974606,
          -0.06,
          -2.9152817400797155
        ],
        [
          2.922582631938249,
          13.960986689872541,
          2.94544852726871
        ]
      ],
      bytes: 2682980,
      emissive: [],
      file: "7ddaf60f27d118dcbdb01fefb3cad459f64574a5448eadbc945f69e439c73b20.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-fir-b/lod0",
        "model/tree-fir-b/lod1",
        "model/tree-fir-b/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-fir-b"
      ],
      note: "alpine conifer, 6 rounded tiers (LOD2: 2), closed shells, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "7ddaf60f27d118dcbdb01fefb3cad459f64574a5448eadbc945f69e439c73b20",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "eb178ca91240d998b70aa180a00f2aff3b201cf6ee1c73e9264fa57973391824.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall dark green fir tree in layered tiers of needles, warm lit edges, blue-green shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "conifer",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            H: 14.05,
            W: 2.7,
            colour: "#3a8a4e",
            h0: 1,
            lobes: [
              8,
              8,
              7,
              7,
              6,
              5
            ],
            seed: 5,
            tiers: 6,
            trunk_r: 0.28
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "alpine-peaks"
      ],
      tris: 7248
    },
    "model/tree-fir-b/lod1": {
      bounds_m: [
        [
          -2.619973625651836,
          -0.06,
          -2.434428562523666
        ],
        [
          2.6358427285324457,
          13.964312729931661,
          2.4513028977768947
        ]
      ],
      bytes: 2460488,
      emissive: [],
      file: "0e26527424077eb637ab7048bc6d53758377845b7f273419238acc1412da5555.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-fir-b/lod0",
        "model/tree-fir-b/lod1",
        "model/tree-fir-b/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-fir-b"
      ],
      note: "alpine conifer, 6 rounded tiers (LOD2: 2), closed shells, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "0e26527424077eb637ab7048bc6d53758377845b7f273419238acc1412da5555",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "dd4044e46af3b38ba91bb2e85eae4f9223de57bc048f669edfe7b5287bdd818f.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall dark green fir tree in layered tiers of needles, warm lit edges, blue-green shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "conifer",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            H: 14.05,
            W: 2.7,
            colour: "#3a8a4e",
            h0: 1,
            lobes: [
              8,
              8,
              7,
              7,
              6,
              5
            ],
            seed: 5,
            tiers: 6,
            trunk_r: 0.28
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "alpine-peaks"
      ],
      tris: 1728
    },
    "model/tree-fir-b/lod2": {
      bounds_m: [
        [
          -2.7121751973925603,
          -0.06,
          -2.507187698348207
        ],
        [
          2.544325736621515,
          14.059219019766955,
          2.55911934269393
        ]
      ],
      bytes: 2394132,
      emissive: [],
      file: "2a712f0adb2f29a98a2bd7e83369ed32a5003d1c5b4192f53c127ec76fff29ba.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-fir-b/lod0",
        "model/tree-fir-b/lod1",
        "model/tree-fir-b/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-fir-b"
      ],
      note: "alpine conifer, 6 rounded tiers (LOD2: 2), closed shells, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "2a712f0adb2f29a98a2bd7e83369ed32a5003d1c5b4192f53c127ec76fff29ba",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "43e7494579e6b9f7bec258330e566f0d90d515f8467f5cb78fc3fca898fd6774.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a tall dark green fir tree in layered tiers of needles, warm lit edges, blue-green shade",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "conifer",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            H: 14.05,
            W: 2.7,
            colour: "#3a8a4e",
            h0: 1,
            lobes: [
              8,
              8,
              7,
              7,
              6,
              5
            ],
            seed: 5,
            tiers: 6,
            trunk_r: 0.28
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "alpine-peaks"
      ],
      tris: 280
    },
    "model/tree-jacaranda/lod0": {
      bounds_m: [
        [
          -12.853829683904964,
          0,
          -9.532981325641796
        ],
        [
          11.56321972405402,
          19.468875035643578,
          9.621593068584279
        ]
      ],
      build: {
        budget: 4e4,
        cards: [
          {
            atoms: 116084,
            cards: 14025,
            coverage: 0.1650538593530655,
            lod: 0,
            source_tris: 2402434,
            texel_per_m: 34.04498899040752
          },
          {
            atoms: 116084,
            cards: 3542,
            coverage: 0.15369868278503418,
            lod: 1,
            source_tris: 2402434,
            texel_per_m: 19.278119403237916
          },
          {
            atoms: 116084,
            cards: 859,
            coverage: 0.13893651962280273,
            lod: 2,
            source_tris: 2402434,
            texel_per_m: 10.54128686765997
          }
        ],
        compose: null,
        foliage: "billboard-cloud",
        nodes: null,
        origin: "base"
      },
      bytes: 6460184,
      file: "8d4d4f2d74078098726c3a80a63ed2db5d9a40f0f759cfab931771518d9ca68a.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-jacaranda/lod0",
        "model/tree-jacaranda/lod1",
        "model/tree-jacaranda/lod2"
      ],
      sha256: "8d4d4f2d74078098726c3a80a63ed2db5d9a40f0f759cfab931771518d9ca68a",
      source: {
        polyhaven: {
          id: "jacaranda_tree",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/jacaranda_tree/jacaranda_tree_2k.gltf"
        }
      },
      source_tris: {
        foliage: 2402434,
        solid: 1461398
      },
      stages: [
        "tulip-gardens",
        "ancient-ruins"
      ],
      texture_size: {
        foliage_atlas: 2048,
        solid: 1024
      },
      tris: 35079
    },
    "model/tree-jacaranda/lod1": {
      bounds_m: [
        [
          -12.853829683904964,
          0,
          -9.532981325641796
        ],
        [
          11.56321972405402,
          19.468875035643578,
          9.621593068584279
        ]
      ],
      build: {
        budget: 4e4,
        cards: [
          {
            atoms: 116084,
            cards: 14025,
            coverage: 0.1650538593530655,
            lod: 0,
            source_tris: 2402434,
            texel_per_m: 34.04498899040752
          },
          {
            atoms: 116084,
            cards: 3542,
            coverage: 0.15369868278503418,
            lod: 1,
            source_tris: 2402434,
            texel_per_m: 19.278119403237916
          },
          {
            atoms: 116084,
            cards: 859,
            coverage: 0.13893651962280273,
            lod: 2,
            source_tris: 2402434,
            texel_per_m: 10.54128686765997
          }
        ],
        compose: null,
        foliage: "billboard-cloud",
        nodes: null,
        origin: "base"
      },
      bytes: 1342128,
      file: "4bf739b00ddabb513a0c80fac2b78da5f44b3c2444cf47990dfef21a55cc18f8.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-jacaranda/lod0",
        "model/tree-jacaranda/lod1",
        "model/tree-jacaranda/lod2"
      ],
      sha256: "4bf739b00ddabb513a0c80fac2b78da5f44b3c2444cf47990dfef21a55cc18f8",
      source: {
        polyhaven: {
          id: "jacaranda_tree",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/jacaranda_tree/jacaranda_tree_2k.gltf"
        }
      },
      source_tris: {
        foliage: 2402434,
        solid: 1461398
      },
      stages: [
        "tulip-gardens",
        "ancient-ruins"
      ],
      texture_size: {
        foliage_atlas: 1024,
        solid: 512
      },
      tris: 9869
    },
    "model/tree-jacaranda/lod2": {
      bounds_m: [
        [
          -12.853829683904964,
          0,
          -9.532981325641796
        ],
        [
          11.56321972405402,
          19.468875035643578,
          9.621593068584279
        ]
      ],
      build: {
        budget: 4e4,
        cards: [
          {
            atoms: 116084,
            cards: 14025,
            coverage: 0.1650538593530655,
            lod: 0,
            source_tris: 2402434,
            texel_per_m: 34.04498899040752
          },
          {
            atoms: 116084,
            cards: 3542,
            coverage: 0.15369868278503418,
            lod: 1,
            source_tris: 2402434,
            texel_per_m: 19.278119403237916
          },
          {
            atoms: 116084,
            cards: 859,
            coverage: 0.13893651962280273,
            lod: 2,
            source_tris: 2402434,
            texel_per_m: 10.54128686765997
          }
        ],
        compose: null,
        foliage: "billboard-cloud",
        nodes: null,
        origin: "base"
      },
      bytes: 283208,
      file: "22ef1b72c711cb666f664a64fa3bdf3ecb4024e50d33391e5d331e2f3f00e356.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-jacaranda/lod0",
        "model/tree-jacaranda/lod1",
        "model/tree-jacaranda/lod2"
      ],
      sha256: "22ef1b72c711cb666f664a64fa3bdf3ecb4024e50d33391e5d331e2f3f00e356",
      source: {
        polyhaven: {
          id: "jacaranda_tree",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/jacaranda_tree/jacaranda_tree_2k.gltf"
        }
      },
      source_tris: {
        foliage: 2402434,
        solid: 1461398
      },
      stages: [
        "tulip-gardens",
        "ancient-ruins"
      ],
      texture_size: {
        foliage_atlas: 512,
        solid: 256
      },
      tris: 2257
    },
    "model/tree-pine-young/lod0": {
      bounds_m: [
        [
          -0.4302717987127863,
          -0.06,
          -0.4229791241649528
        ],
        [
          0.43778852244606375,
          1.2831890285440557,
          0.3995752315328407
        ]
      ],
      bytes: 2598252,
      emissive: [],
      file: "829d38f613944a12a0fe34dc2b1b73a2f6c86fb6e70de78b11de21ebe0295ac2.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-pine-young/lod0",
        "model/tree-pine-young/lod1",
        "model/tree-pine-young/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-pine-young"
      ],
      note: "alpine conifer, 3 rounded tiers (LOD2: 2), closed shells, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "829d38f613944a12a0fe34dc2b1b73a2f6c86fb6e70de78b11de21ebe0295ac2",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "50fbf860964356a96fd02773921995947716aa4d1ab0720f5708813770fbcdfb.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a young green pine tree, layered tiers of needles",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "conifer",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            H: 1.3,
            W: 0.41,
            colour: "#6cbb66",
            h0: 0.1,
            lobes: [
              6,
              6,
              5
            ],
            seed: 7,
            tiers: 3,
            trunk_r: 0.035
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass"
      ],
      tris: 3564
    },
    "model/tree-pine-young/lod1": {
      bounds_m: [
        [
          -0.41978226495951243,
          -0.06,
          -0.40453432746313045
        ],
        [
          0.42636553287283857,
          1.281197975239454,
          0.38927615655538583
        ]
      ],
      bytes: 2491052,
      emissive: [],
      file: "46870f7734e13bb9f67ea7abe8a20d05e62662c1488e7b0fffd601850dc287ca.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-pine-young/lod0",
        "model/tree-pine-young/lod1",
        "model/tree-pine-young/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-pine-young"
      ],
      note: "alpine conifer, 3 rounded tiers (LOD2: 2), closed shells, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "46870f7734e13bb9f67ea7abe8a20d05e62662c1488e7b0fffd601850dc287ca",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "6349e67a49ebeaeb8d9af5cc3ec45f1730105ed7d010e49df7b4c78309d52363.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a young green pine tree, layered tiers of needles",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "conifer",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            H: 1.3,
            W: 0.41,
            colour: "#6cbb66",
            h0: 0.1,
            lobes: [
              6,
              6,
              5
            ],
            seed: 7,
            tiers: 3,
            trunk_r: 0.035
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass"
      ],
      tris: 900
    },
    "model/tree-pine-young/lod2": {
      bounds_m: [
        [
          -0.37810387924679156,
          -0.06,
          -0.36548936587842
        ],
        [
          0.3832216369391667,
          1.2906458961663627,
          0.37502001547090835
        ]
      ],
      bytes: 2464116,
      emissive: [],
      file: "d27495493040ca5df5bcc7694db0abf4577864cdb8d684a0b57c3dca5dc60cc5.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-pine-young/lod0",
        "model/tree-pine-young/lod1",
        "model/tree-pine-young/lod2"
      ],
      materials: [
        "foliage",
        "bark"
      ],
      nodes: [
        "tree-pine-young"
      ],
      note: "alpine conifer, 3 rounded tiers (LOD2: 2), closed shells, painted leaf masses; painted surface baked by projection: one SDXL gouache atlas over UVs added by xatlas, ray-traced COLOR_0 AO and impasto normalTexture",
      sha256: "d27495493040ca5df5bcc7694db0abf4577864cdb8d684a0b57c3dca5dc60cc5",
      source: {
        baked: {
          atlas_px: [
            2048,
            1024,
            512
          ],
          controlnets: [
            {
              model: "diffusers/controlnet-depth-sdxl-1.0",
              revision: "17bb97973f29801224cd66f192c5ffacf82648b4",
              scale: 0.8
            },
            {
              model: "diffusers/controlnet-canny-sdxl-1.0",
              revision: "eb115a19a10d14909256db740ed109532ab1483c",
              scale: 0.5
            }
          ],
          from: "abf8e1c6d39446552313f2d075846d67d708e4d3372e59e6c763e20fae33ef5b.glb",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, animals, photo, photorealistic, 3d render, plastic, flat vector illustration, cel shading, frame, border, ground, sky",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli background art, opaque layered paint, soft visible brushwork, warm afternoon light, soft cool shadow, isolated on a plain pale background, a young green pine tree, layered tiers of needles",
          script: "tools/ghibli/bake/bake.py",
          script_sha256: "068d1a48c75de215eee97c620455e5f2f519b582d0c5dfb28fb46ef9d6b0f4d6",
          seed: 21,
          steps: 34,
          strength: 0.75,
          unwrap: "xatlas 0.0.10",
          vae: "madebyollin/sdxl-vae-fp16-fix",
          view_px: 1024,
          views: [
            [
              0,
              0.18
            ],
            [
              1.0472,
              0.18
            ],
            [
              2.0944,
              0.18
            ],
            [
              3.1416,
              0.18
            ],
            [
              4.1888,
              0.18
            ],
            [
              5.236,
              0.18
            ],
            [
              0.7854,
              0.68
            ],
            [
              3.927,
              0.68
            ]
          ]
        },
        procedural: {
          builder: "conifer",
          kit_sha256: "ef94683bb2ec19a45782e00b7b33b601985f261bb62a5bea6dda70846995dc8c",
          params: {
            H: 1.3,
            W: 0.41,
            colour: "#6cbb66",
            h0: 0.1,
            lobes: [
              6,
              6,
              5
            ],
            seed: 7,
            tiers: 3,
            trunk_r: 0.035
          },
          script: "cartoon/plants/plants.py",
          script_sha256: "5e70a34acfd4151085de39a987c9b7ba17bbac802ef6b01cc465dfb088f25042"
        }
      },
      stages: [
        "alpine-peaks",
        "gateway-pass"
      ],
      tris: 280
    },
    "model/tree-quiver/lod0": {
      bounds_m: [
        [
          -0.5414705486986154,
          0,
          -0.4422608835311248
        ],
        [
          0.6397651223447806,
          2.715420752763748,
          0.5262445586113618
        ]
      ],
      build: {
        budget: 16e3,
        cards: [
          {
            atoms: 113154,
            cards: 5462,
            coverage: 0.27122968435287476,
            lod: 0,
            source_tris: 113154,
            texel_per_m: 939.3501087019031
          },
          {
            atoms: 113154,
            cards: 1396,
            coverage: 0.287756085395813,
            lod: 1,
            source_tris: 113154,
            texel_per_m: 567.6987342781314
          },
          {
            atoms: 413,
            cards: 343,
            coverage: 0.13034939765930176,
            lod: 2,
            source_tris: 113154,
            texel_per_m: 196.77911077903127
          }
        ],
        compose: null,
        foliage: "billboard-cloud",
        nodes: null,
        origin: "base"
      },
      bytes: 3004608,
      file: "25ed6c9ba56f17bce9c124c8726401fefff2a0cadb1cb7125e51d206ddd71c14.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-quiver/lod0",
        "model/tree-quiver/lod1",
        "model/tree-quiver/lod2"
      ],
      sha256: "25ed6c9ba56f17bce9c124c8726401fefff2a0cadb1cb7125e51d206ddd71c14",
      source: {
        polyhaven: {
          id: "quiver_tree_01",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/quiver_tree_01/quiver_tree_01_2k.gltf"
        }
      },
      source_tris: {
        foliage: 113154,
        solid: 36970
      },
      stages: [
        "desert-canyons"
      ],
      texture_size: {
        foliage_atlas: 2048,
        solid: 1024
      },
      tris: 15722
    },
    "model/tree-quiver/lod1": {
      bounds_m: [
        [
          -0.5414705486986154,
          0,
          -0.4422608835311248
        ],
        [
          0.6397651223447806,
          2.715420752763748,
          0.5262445586113618
        ]
      ],
      build: {
        budget: 16e3,
        cards: [
          {
            atoms: 113154,
            cards: 5462,
            coverage: 0.27122968435287476,
            lod: 0,
            source_tris: 113154,
            texel_per_m: 939.3501087019031
          },
          {
            atoms: 113154,
            cards: 1396,
            coverage: 0.287756085395813,
            lod: 1,
            source_tris: 113154,
            texel_per_m: 567.6987342781314
          },
          {
            atoms: 413,
            cards: 343,
            coverage: 0.13034939765930176,
            lod: 2,
            source_tris: 113154,
            texel_per_m: 196.77911077903127
          }
        ],
        compose: null,
        foliage: "billboard-cloud",
        nodes: null,
        origin: "base"
      },
      bytes: 575876,
      file: "410abb3d8c84075e506c818eeb9d33441f879bee1a600944fca472552271de0f.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-quiver/lod0",
        "model/tree-quiver/lod1",
        "model/tree-quiver/lod2"
      ],
      sha256: "410abb3d8c84075e506c818eeb9d33441f879bee1a600944fca472552271de0f",
      source: {
        polyhaven: {
          id: "quiver_tree_01",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/quiver_tree_01/quiver_tree_01_2k.gltf"
        }
      },
      source_tris: {
        foliage: 113154,
        solid: 36970
      },
      stages: [
        "desert-canyons"
      ],
      texture_size: {
        foliage_atlas: 1024,
        solid: 512
      },
      tris: 3992
    },
    "model/tree-quiver/lod2": {
      bounds_m: [
        [
          -0.5414705486986154,
          0,
          -0.4422608835311248
        ],
        [
          0.6397651223447806,
          2.715420752763748,
          0.5262445586113618
        ]
      ],
      build: {
        budget: 16e3,
        cards: [
          {
            atoms: 113154,
            cards: 5462,
            coverage: 0.27122968435287476,
            lod: 0,
            source_tris: 113154,
            texel_per_m: 939.3501087019031
          },
          {
            atoms: 113154,
            cards: 1396,
            coverage: 0.287756085395813,
            lod: 1,
            source_tris: 113154,
            texel_per_m: 567.6987342781314
          },
          {
            atoms: 413,
            cards: 343,
            coverage: 0.13034939765930176,
            lod: 2,
            source_tris: 113154,
            texel_per_m: 196.77911077903127
          }
        ],
        compose: null,
        foliage: "billboard-cloud",
        nodes: null,
        origin: "base"
      },
      bytes: 118124,
      file: "58a30ca18287971422dcdf3e03ce19651d12aed7c3e5509ffa2aafcd72b662ab.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/tree-quiver/lod0",
        "model/tree-quiver/lod1",
        "model/tree-quiver/lod2"
      ],
      sha256: "58a30ca18287971422dcdf3e03ce19651d12aed7c3e5509ffa2aafcd72b662ab",
      source: {
        polyhaven: {
          id: "quiver_tree_01",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/quiver_tree_01/quiver_tree_01_2k.gltf"
        }
      },
      source_tris: {
        foliage: 113154,
        solid: 36970
      },
      stages: [
        "desert-canyons"
      ],
      texture_size: {
        foliage_atlas: 512,
        solid: 256
      },
      tris: 972
    },
    "model/utility-box/lod0": {
      bounds_m: [
        [
          -0.46000009775161743,
          0,
          -0.215999998152256
        ],
        [
          0.46000009775161743,
          1.1203334331512451,
          0.215999998152256
        ]
      ],
      build: {
        budget: 2e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 172876,
      file: "55e8da36874bcc397e3722147d57832166f5d906525c479a676564eea1733086.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/utility-box/lod0",
        "model/utility-box/lod1",
        "model/utility-box/lod2"
      ],
      sha256: "55e8da36874bcc397e3722147d57832166f5d906525c479a676564eea1733086",
      source: {
        polyhaven: {
          id: "utility_box_02",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/utility_box_02/utility_box_02_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 6268
      },
      stages: [
        "metropolis-night"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 512
      },
      tris: 1999
    },
    "model/utility-box/lod1": {
      bounds_m: [
        [
          -0.46000009775161743,
          0,
          -0.215999998152256
        ],
        [
          0.46000009775161743,
          1.1203334331512451,
          0.215999998152256
        ]
      ],
      build: {
        budget: 2e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 52172,
      file: "7b32ca154d4e2dc79435577a56279817c86b21088c53200aace590e81ecebfa3.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/utility-box/lod0",
        "model/utility-box/lod1",
        "model/utility-box/lod2"
      ],
      sha256: "7b32ca154d4e2dc79435577a56279817c86b21088c53200aace590e81ecebfa3",
      source: {
        polyhaven: {
          id: "utility_box_02",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/utility_box_02/utility_box_02_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 6268
      },
      stages: [
        "metropolis-night"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 256
      },
      tris: 498
    },
    "model/utility-box/lod2": {
      bounds_m: [
        [
          -0.46000009775161743,
          0,
          -0.215999998152256
        ],
        [
          0.46000009775161743,
          1.1203334331512451,
          0.215999998152256
        ]
      ],
      build: {
        budget: 2e3,
        cards: null,
        compose: null,
        foliage: null,
        nodes: null,
        origin: "bbox"
      },
      bytes: 13208,
      file: "8db6be8f87b4c748376bf27515c71a67494f8aab1ad16eae0058a46d55cb9b4e.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/utility-box/lod0",
        "model/utility-box/lod1",
        "model/utility-box/lod2"
      ],
      sha256: "8db6be8f87b4c748376bf27515c71a67494f8aab1ad16eae0058a46d55cb9b4e",
      source: {
        polyhaven: {
          id: "utility_box_02",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/2k/utility_box_02/utility_box_02_2k.gltf"
        }
      },
      source_tris: {
        foliage: 0,
        solid: 6268
      },
      stages: [
        "metropolis-night"
      ],
      texture_size: {
        foliage_atlas: null,
        solid: 128
      },
      tris: 120
    },
    "model/windmill/lod0": {
      bounds_m: [
        [
          -7.672108575874041,
          0,
          -5.3100000000000005
        ],
        [
          7.6721085758740415,
          21.67210857587404,
          5.309999999999999
        ]
      ],
      bytes: 153600,
      emissive: [],
      file: "ceb21a294a27891471dd468451b531efbf4d8a05321da63da7234b747891f345.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/windmill/lod0",
        "model/windmill/lod1",
        "model/windmill/lod2"
      ],
      materials: [
        "brick",
        "boards",
        "wood",
        "cap",
        "door",
        "dark",
        "sail_frame",
        "sail_cloth"
      ],
      nodes: [
        "windmill",
        "sails"
      ],
      note: "node `sails` is translated to the hub [0.0, 14.0, 3.9] and turns about its local +Z (the windshaft); sail tips sweep a 9.0 m radius (lowest tip 5.0 m, clear of the 4.6 m gallery rail); door faces +Z under the sails",
      pivots: {
        sails: [
          0,
          14,
          3.9
        ]
      },
      sha256: "ceb21a294a27891471dd468451b531efbf4d8a05321da63da7234b747891f345",
      source: {
        procedural: {
          builder: "windmill",
          params: {},
          script: "scripts/props_b.py",
          script_sha256: "f0050ddc5cc0b269469e725adab8dc39dc896f924b1d8f2e68fd60f1fb7b38fc"
        }
      },
      tris: 1948
    },
    "model/windmill/lod1": {
      bounds_m: [
        [
          -7.672108575874041,
          0,
          -5.3100000000000005
        ],
        [
          7.6721085758740415,
          21.67210857587404,
          5.309999999999999
        ]
      ],
      bytes: 67956,
      emissive: [],
      file: "65a6b425f9700185c666fbab3709da2a5d0b3f5947e1756ecf2d3b8ceddd292c.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/windmill/lod0",
        "model/windmill/lod1",
        "model/windmill/lod2"
      ],
      materials: [
        "brick",
        "boards",
        "wood",
        "cap",
        "door",
        "dark",
        "sail_frame",
        "sail_cloth"
      ],
      nodes: [
        "windmill",
        "sails"
      ],
      note: "node `sails` is translated to the hub [0.0, 14.0, 3.9] and turns about its local +Z (the windshaft); sail tips sweep a 9.0 m radius (lowest tip 5.0 m, clear of the 4.6 m gallery rail); door faces +Z under the sails",
      pivots: {
        sails: [
          0,
          14,
          3.9
        ]
      },
      sha256: "65a6b425f9700185c666fbab3709da2a5d0b3f5947e1756ecf2d3b8ceddd292c",
      source: {
        procedural: {
          builder: "windmill",
          params: {},
          script: "scripts/props_b.py",
          script_sha256: "f0050ddc5cc0b269469e725adab8dc39dc896f924b1d8f2e68fd60f1fb7b38fc"
        }
      },
      tris: 1132
    },
    "model/windmill/lod2": {
      bounds_m: [
        [
          -7.537758287448597,
          0,
          -4.98894947556095
        ],
        [
          7.5377582874485975,
          21.537758287448597,
          4.988949475560949
        ]
      ],
      bytes: 22476,
      emissive: [],
      file: "7de2fe8e9dc42b6dd56e0d4346f861d8804c513c2226f5c375f2a1c27dde0b5c.glb",
      kind: "model",
      license: "CC0",
      lods: [
        "model/windmill/lod0",
        "model/windmill/lod1",
        "model/windmill/lod2"
      ],
      materials: [
        "brick",
        "boards",
        "wood",
        "cap",
        "sail_frame",
        "sail_cloth"
      ],
      nodes: [
        "windmill",
        "sails"
      ],
      note: "node `sails` is translated to the hub [0.0, 14.0, 3.9] and turns about its local +Z (the windshaft); sail tips sweep a 9.0 m radius (lowest tip 5.0 m, clear of the 4.6 m gallery rail); door faces +Z under the sails",
      pivots: {
        sails: [
          0,
          14,
          3.9
        ]
      },
      sha256: "7de2fe8e9dc42b6dd56e0d4346f861d8804c513c2226f5c375f2a1c27dde0b5c",
      source: {
        procedural: {
          builder: "windmill",
          params: {},
          script: "scripts/props_b.py",
          script_sha256: "f0050ddc5cc0b269469e725adab8dc39dc896f924b1d8f2e68fd60f1fb7b38fc"
        }
      },
      tris: 280
    },
    "sky/alpine-peaks.env": {
      bytes: 2110167,
      file: "99f70057d1ba3b8ff3ffeb98b1e65061b770470199cee3dc0e848814957a7d5b.env",
      irradiance_up: [
        0.3751764362906708,
        0.43511759929325783,
        0.6272697137674927
      ],
      kind: "hdri-env",
      license: "CC0",
      note: "sun disc clamped out of the IBL; add it back as a Babylon DirectionalLight: direction -sun_dir, diffuse*intensity = sun_light_rgb",
      object_exposure: 0.6743792287208862,
      prefilter: {
        babylon: "9.31.0",
        cube_size: 512,
        engine: "WebGPU",
        imageType: "image/png",
        tool: "BABYLON.EnvironmentTextureTools.CreateEnvTextureAsync"
      },
      sha256: "99f70057d1ba3b8ff3ffeb98b1e65061b770470199cee3dc0e848814957a7d5b",
      source: {
        polyhaven: {
          id: "kloofendal_48d_partly_cloudy_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr"
        }
      },
      sun_clamp: 13.7871253490448,
      sun_dir: [
        0.3775838521961985,
        0.7417322508432763,
        -0.5543137222003859
      ],
      sun_illuminance_rgb: [
        4.433622554754235,
        4.469569080234931,
        4.066765259313842
      ],
      sun_light_rgb: [
        1.4112658907857079,
        1.4227080252201707,
        1.294491586828383
      ],
      sun_peak_ratio: 8349.486328125
    },
    "sky/alpine-peaks.jpg": {
      bytes: 151258,
      file: "c91ddaf1adb2970172552dcc15dd02f64e5c58e106b6e1d58cb0128b39f7dbf9.jpg",
      kind: "sky",
      license: "CC0",
      projection: "equirectangular",
      sha256: "c91ddaf1adb2970172552dcc15dd02f64e5c58e106b6e1d58cb0128b39f7dbf9",
      size: [
        2048,
        1024
      ],
      source: {
        polyhaven: {
          id: "kloofendal_48d_partly_cloudy_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr"
        }
      },
      tonemap: {
        exposure: 0.5213668071239045,
        jpeg_quality: 88,
        key: 0.18,
        tonemap: "aces-fitted"
      }
    },
    "sky/alpine-peaks.paint.jpg": {
      bytes: 220888,
      file: "40c97a9346cf06105aff560087a35801122c020c29da349e8a6dd55975a82d3d.jpg",
      horizon_srgb: [
        0.6708999872207642,
        0.7886999845504761,
        0.7954000234603882
      ],
      kind: "sky",
      license: "CC0",
      note: "painted sky dome: 2048x1024 equirect, horizon at the middle; the game undoes ACES and the exposure when drawing it",
      sha256: "40c97a9346cf06105aff560087a35801122c020c29da349e8a6dd55975a82d3d",
      source: {
        generated: {
          afternoon: [
            [
              62,
              120,
              178
            ],
            [
              170,
              202,
              208
            ]
          ],
          cream: [
            250,
            244,
            228
          ],
          from: "c91ddaf1adb2970172552dcc15dd02f64e5c58e106b6e1d58cb0128b39f7dbf9",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, trees, land, mountains, animals, photo, photorealistic, noisy, buildings, city",
          padding: "circular",
          prompt: "gouache sky painting by Kazuo Oga, Studio Ghibli background art, towering white cumulus clouds with warm sunlit tops and soft blue-grey shaded bellies, deep clear sky, opaque layered paint, soft visible brushwork",
          seed: 11,
          source: "sky/alpine-peaks.jpg",
          steps: 40,
          strength: 0.7,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "sky/ancient-ruins.env": {
      bytes: 1688986,
      file: "e469ffb3829f62edcfe1cc4ad462f63658e37eccaac7de45ae1ce0a4d3283056.env",
      irradiance_up: [
        0.23363162701081877,
        0.26026133281769087,
        0.2953335401109376
      ],
      kind: "hdri-env",
      license: "CC0",
      note: "sun disc clamped out of the IBL; add it back as a Babylon DirectionalLight: direction -sun_dir, diffuse*intensity = sun_light_rgb",
      object_exposure: 2.565870391053236,
      prefilter: {
        babylon: "9.31.0",
        cube_size: 512,
        engine: "WebGPU",
        imageType: "image/png",
        tool: "BABYLON.EnvironmentTextureTools.CreateEnvTextureAsync"
      },
      sha256: "e469ffb3829f62edcfe1cc4ad462f63658e37eccaac7de45ae1ce0a4d3283056",
      source: {
        polyhaven: {
          id: "table_mountain_2_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/table_mountain_2_puresky_2k.hdr"
        }
      },
      sun_clamp: 5.5557966232299805,
      sun_dir: [
        0.7575993806852547,
        0.124177420369719,
        -0.6407988347801833
      ],
      sun_illuminance_rgb: [
        3.955627880478521,
        3.346007608611491,
        1.6707305046832646
      ],
      sun_light_rgb: [
        1.2591154604205472,
        1.0650673010672214,
        0.5318100367895171
      ],
      sun_peak_ratio: 11103.6767578125
    },
    "sky/ancient-ruins.jpg": {
      bytes: 106385,
      file: "d7420958e04f071a6ba2cd2bae2ae7086a10460e46a9bb2d1e548436032bdf22.jpg",
      kind: "sky",
      license: "CC0",
      projection: "equirectangular",
      sha256: "d7420958e04f071a6ba2cd2bae2ae7086a10460e46a9bb2d1e548436032bdf22",
      size: [
        2048,
        1024
      ],
      source: {
        polyhaven: {
          id: "table_mountain_2_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/table_mountain_2_puresky_2k.hdr"
        }
      },
      tonemap: {
        exposure: 1.0929344326860586,
        jpeg_quality: 88,
        key: 0.18,
        tonemap: "aces-fitted"
      }
    },
    "sky/ancient-ruins.paint.jpg": {
      bytes: 144057,
      file: "3f88eb47bbb42463d50bafac30520ab025287b2ca5047ef12de0919d4d713d3d.jpg",
      horizon_srgb: [
        0.8726999759674072,
        0.8810999989509583,
        0.82669997215271
      ],
      kind: "sky",
      license: "CC0",
      note: "painted sky dome: 2048x1024 equirect, horizon at the middle; the game undoes ACES and the exposure when drawing it",
      sha256: "3f88eb47bbb42463d50bafac30520ab025287b2ca5047ef12de0919d4d713d3d",
      source: {
        generated: {
          afternoon: [
            [
              62,
              120,
              178
            ],
            [
              170,
              202,
              208
            ]
          ],
          cream: [
            250,
            244,
            228
          ],
          from: "d7420958e04f071a6ba2cd2bae2ae7086a10460e46a9bb2d1e548436032bdf22",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, trees, land, mountains, animals, photo, photorealistic, noisy, buildings, city",
          padding: "circular",
          prompt: "gouache sky painting by Kazuo Oga, Studio Ghibli background art, towering white cumulus clouds with warm sunlit tops and soft blue-grey shaded bellies, deep clear sky, opaque layered paint, soft visible brushwork",
          seed: 11,
          source: "sky/ancient-ruins.jpg",
          steps: 40,
          strength: 0.7,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "sky/coconut-beach.env": {
      bytes: 1752247,
      file: "1770c59f06dbb4beed6888f6db0d228962865842bd5a59943ef20634f41902f5.env",
      irradiance_up: [
        0.827758463875075,
        0.9205256196007832,
        1.1293256711207116
      ],
      kind: "hdri-env",
      license: "CC0",
      note: "sun disc clamped out of the IBL; add it back as a Babylon DirectionalLight: direction -sun_dir, diffuse*intensity = sun_light_rgb",
      object_exposure: 0.9725154253782224,
      prefilter: {
        babylon: "9.31.0",
        cube_size: 512,
        engine: "WebGPU",
        imageType: "image/png",
        tool: "BABYLON.EnvironmentTextureTools.CreateEnvTextureAsync"
      },
      sha256: "1770c59f06dbb4beed6888f6db0d228962865842bd5a59943ef20634f41902f5",
      source: {
        polyhaven: {
          id: "qwantani_sunset_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/qwantani_sunset_puresky_2k.hdr"
        }
      },
      sun_clamp: 21.095688343048096,
      sun_dir: [
        0.5848171285191074,
        0.10599699287760456,
        -0.804209900269557
      ],
      sun_illuminance_rgb: [
        7.218765817381254,
        2.4941081515959347,
        0.17116223803704292
      ],
      sun_light_rgb: [
        2.2978045257180657,
        0.7938992818645665,
        0.05448263250853402
      ],
      sun_peak_ratio: 2927.44384765625
    },
    "sky/coconut-beach.jpg": {
      bytes: 65158,
      file: "0ce0515f6b057e1d0cdb741a691f79120a8ec4998c80fde12a3eb522f104d2ad.jpg",
      kind: "sky",
      license: "CC0",
      projection: "equirectangular",
      sha256: "0ce0515f6b057e1d0cdb741a691f79120a8ec4998c80fde12a3eb522f104d2ad",
      size: [
        2048,
        1024
      ],
      source: {
        polyhaven: {
          id: "qwantani_sunset_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/qwantani_sunset_puresky_2k.hdr"
        }
      },
      tonemap: {
        exposure: 0.2811889887919158,
        jpeg_quality: 88,
        key: 0.18,
        tonemap: "aces-fitted"
      }
    },
    "sky/coconut-beach.paint.jpg": {
      bytes: 136768,
      file: "6bbca716a31420a2bb4799256ba6e7d288f51a1ecadb7a639fff08954f38b9bf.jpg",
      horizon_srgb: [
        0.8079000115394592,
        0.8531000018119812,
        0.8144000172615051
      ],
      kind: "sky",
      license: "CC0",
      note: "painted sky dome: 2048x1024 equirect, horizon at the middle; the game undoes ACES and the exposure when drawing it",
      sha256: "6bbca716a31420a2bb4799256ba6e7d288f51a1ecadb7a639fff08954f38b9bf",
      source: {
        generated: {
          afternoon: [
            [
              62,
              120,
              178
            ],
            [
              170,
              202,
              208
            ]
          ],
          cream: [
            250,
            244,
            228
          ],
          from: "0ce0515f6b057e1d0cdb741a691f79120a8ec4998c80fde12a3eb522f104d2ad",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, trees, land, mountains, animals, photo, photorealistic, noisy, buildings, city",
          padding: "circular",
          prompt: "gouache sky painting by Kazuo Oga, Studio Ghibli background art, towering white cumulus clouds with warm sunlit tops and soft blue-grey shaded bellies, deep clear sky, opaque layered paint, soft visible brushwork",
          seed: 11,
          source: "sky/coconut-beach.jpg",
          steps: 40,
          strength: 0.7,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "sky/desert-canyons.env": {
      bytes: 1499283,
      file: "46d6dfec082f8bbf61b1a07f2dc120467410dca95b815d82ca3bc92c3f7210a5.env",
      irradiance_up: [
        0.1994419977634934,
        0.2927264359206605,
        0.5062719269020632
      ],
      kind: "hdri-env",
      license: "CC0",
      note: "sun disc clamped out of the IBL; add it back as a Babylon DirectionalLight: direction -sun_dir, diffuse*intensity = sun_light_rgb",
      object_exposure: 0.35089749170741347,
      prefilter: {
        babylon: "9.31.0",
        cube_size: 512,
        engine: "WebGPU",
        imageType: "image/png",
        tool: "BABYLON.EnvironmentTextureTools.CreateEnvTextureAsync"
      },
      sha256: "46d6dfec082f8bbf61b1a07f2dc120467410dca95b815d82ca3bc92c3f7210a5",
      source: {
        polyhaven: {
          id: "rustig_koppie_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/rustig_koppie_puresky_2k.hdr"
        }
      },
      sun_clamp: 4.823671877384186,
      sun_dir: [
        0.5053659927478692,
        0.4739206824537227,
        -0.7211133060182416
      ],
      sun_illuminance_rgb: [
        17.65132232823306,
        16.978761207187564,
        15.018086037601996
      ],
      sun_light_rgb: [
        5.618590401293269,
        5.404507547401634,
        4.780405257327468
      ],
      sun_peak_ratio: 73150.46875
    },
    "sky/desert-canyons.jpg": {
      bytes: 74295,
      file: "797f36bf8df52860e2fa81b717903749a612002477c733d55a543eeaede203a5.jpg",
      kind: "sky",
      license: "CC0",
      projection: "equirectangular",
      sha256: "797f36bf8df52860e2fa81b717903749a612002477c733d55a543eeaede203a5",
      size: [
        2048,
        1024
      ],
      source: {
        polyhaven: {
          id: "rustig_koppie_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/rustig_koppie_puresky_2k.hdr"
        }
      },
      tonemap: {
        exposure: 1.1477640342368192,
        jpeg_quality: 88,
        key: 0.18,
        tonemap: "aces-fitted"
      }
    },
    "sky/desert-canyons.paint.jpg": {
      bytes: 136017,
      file: "73d937e423002761e1f87cebe67004d54fbfe6d6a12ba7b959b54056e5576ff8.jpg",
      horizon_srgb: [
        0.857699990272522,
        0.8737000226974487,
        0.8112000226974487
      ],
      kind: "sky",
      license: "CC0",
      note: "painted sky dome: 2048x1024 equirect, horizon at the middle; the game undoes ACES and the exposure when drawing it",
      sha256: "73d937e423002761e1f87cebe67004d54fbfe6d6a12ba7b959b54056e5576ff8",
      source: {
        generated: {
          afternoon: [
            [
              62,
              120,
              178
            ],
            [
              170,
              202,
              208
            ]
          ],
          cream: [
            250,
            244,
            228
          ],
          from: "797f36bf8df52860e2fa81b717903749a612002477c733d55a543eeaede203a5",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, trees, land, mountains, animals, photo, photorealistic, noisy, buildings, city",
          padding: "circular",
          prompt: "gouache sky painting by Kazuo Oga, Studio Ghibli background art, towering white cumulus clouds with warm sunlit tops and soft blue-grey shaded bellies, deep clear sky, opaque layered paint, soft visible brushwork",
          seed: 11,
          source: "sky/desert-canyons.jpg",
          steps: 40,
          strength: 0.7,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "sky/gateway-pass.env": {
      bytes: 1987613,
      file: "767f64cf4cca3f90a746e453776c9cebe3faa656734c07d9dcffbd49850c22b6.env",
      irradiance_up: [
        1.2591145285138001,
        1.0419969358588699,
        1.4637303785898779
      ],
      kind: "hdri-env",
      license: "CC0",
      note: "sun disc clamped out of the IBL; add it back as a Babylon DirectionalLight: direction -sun_dir, diffuse*intensity = sun_light_rgb",
      object_exposure: 0.8939703829252542,
      prefilter: {
        babylon: "9.31.0",
        cube_size: 512,
        engine: "WebGPU",
        imageType: "image/png",
        tool: "BABYLON.EnvironmentTextureTools.CreateEnvTextureAsync"
      },
      sha256: "767f64cf4cca3f90a746e453776c9cebe3faa656734c07d9dcffbd49850c22b6",
      source: {
        polyhaven: {
          id: "qwantani_dusk_2_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/qwantani_dusk_2_puresky_2k.hdr"
        }
      },
      sun_clamp: 31.693310737609863,
      sun_dir: [
        0.5972790338876647,
        0.19659459767008022,
        -0.7775656370012485
      ],
      sun_illuminance_rgb: [
        0,
        0,
        0
      ],
      sun_light_rgb: [
        0,
        0,
        0
      ],
      sun_peak_ratio: 6.75257682800293
    },
    "sky/gateway-pass.jpg": {
      bytes: 57037,
      file: "f9b40599714e47af0723f5c4eda85ee5f24325c7355ee5c5ff42f3aa1ffb158e.jpg",
      kind: "sky",
      license: "CC0",
      projection: "equirectangular",
      sha256: "f9b40599714e47af0723f5c4eda85ee5f24325c7355ee5c5ff42f3aa1ffb158e",
      size: [
        2048,
        1024
      ],
      source: {
        polyhaven: {
          id: "qwantani_dusk_2_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/qwantani_dusk_2_puresky_2k.hdr"
        }
      },
      tonemap: {
        exposure: 0.191650734161123,
        jpeg_quality: 88,
        key: 0.18,
        tonemap: "aces-fitted"
      }
    },
    "sky/gateway-pass.paint.jpg": {
      bytes: 129165,
      file: "7460a72bc95926b00df47dee77eaa5864976336bb365927d5ac1f7207aca14ff.jpg",
      horizon_srgb: [
        0.6434000134468079,
        0.7757999897003174,
        0.7788000106811523
      ],
      kind: "sky",
      license: "CC0",
      note: "painted sky dome: 2048x1024 equirect, horizon at the middle; the game undoes ACES and the exposure when drawing it",
      sha256: "7460a72bc95926b00df47dee77eaa5864976336bb365927d5ac1f7207aca14ff",
      source: {
        generated: {
          afternoon: [
            [
              62,
              120,
              178
            ],
            [
              170,
              202,
              208
            ]
          ],
          cream: [
            250,
            244,
            228
          ],
          from: "f9b40599714e47af0723f5c4eda85ee5f24325c7355ee5c5ff42f3aa1ffb158e",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, trees, land, mountains, animals, photo, photorealistic, noisy, buildings, city",
          padding: "circular",
          prompt: "gouache sky painting by Kazuo Oga, Studio Ghibli background art, towering white cumulus clouds with warm sunlit tops and soft blue-grey shaded bellies, deep clear sky, opaque layered paint, soft visible brushwork",
          seed: 11,
          source: "sky/gateway-pass.jpg",
          steps: 40,
          strength: 0.7,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "sky/metropolis-night.env": {
      bytes: 3011490,
      file: "b8f7ec060c3f4998a0b0c7d2c1dbb6381d1a3dfb9b86538be1fcaebbf8a935c3.env",
      irradiance_up: [
        0.9695095526913582,
        0.6766576502976485,
        0.5880704441584338
      ],
      kind: "hdri-env",
      license: "CC0",
      note: "sun disc clamped out of the IBL; add it back as a Babylon DirectionalLight: direction -sun_dir, diffuse*intensity = sun_light_rgb",
      object_exposure: 1.3651467710897753,
      prefilter: {
        babylon: "9.31.0",
        cube_size: 512,
        engine: "WebGPU",
        imageType: "image/png",
        tool: "BABYLON.EnvironmentTextureTools.CreateEnvTextureAsync"
      },
      sha256: "b8f7ec060c3f4998a0b0c7d2c1dbb6381d1a3dfb9b86538be1fcaebbf8a935c3",
      source: {
        polyhaven: {
          id: "shanghai_bund",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/shanghai_bund_2k.hdr"
        }
      },
      sun_clamp: 20.600779056549072,
      sun_dir: [
        -0.5319769758966122,
        0.2652340302855119,
        0.8041463836232801
      ],
      sun_illuminance_rgb: [
        0,
        0,
        0
      ],
      sun_light_rgb: [
        0,
        0,
        0
      ],
      sun_peak_ratio: 21625.6484375
    },
    "sky/metropolis-night.jpg": {
      bytes: 376165,
      file: "6da57dc11432c4c1cbba9faa0eafeb7fb1bfc8b03d65678131f126b63ea8795d.jpg",
      kind: "sky",
      license: "CC0",
      projection: "equirectangular",
      sha256: "6da57dc11432c4c1cbba9faa0eafeb7fb1bfc8b03d65678131f126b63ea8795d",
      size: [
        2048,
        1024
      ],
      source: {
        polyhaven: {
          id: "shanghai_bund",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/shanghai_bund_2k.hdr"
        }
      },
      tonemap: {
        exposure: 2.721522391297956,
        jpeg_quality: 88,
        key: 0.18,
        tonemap: "aces-fitted"
      }
    },
    "sky/metropolis-night.paint.jpg": {
      bytes: 312435,
      file: "1c350712dcde073e44dafeacfcc5bb9e327616766883cdaf1f78fe4ad71e69ac.jpg",
      horizon_srgb: [
        0.18199999630451202,
        0.15629999339580536,
        0.20900000631809235
      ],
      kind: "sky",
      license: "CC0",
      note: "painted sky dome: 2048x1024 equirect, horizon at the middle; the game undoes ACES and the exposure when drawing it",
      sha256: "1c350712dcde073e44dafeacfcc5bb9e327616766883cdaf1f78fe4ad71e69ac",
      source: {
        generated: {
          from: "2022aad55d1ee6d6ac2a07e9e2d90f46a2de2d64aaa30d68f8d7c38e16dc49e5",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, trees, animals, photo, photorealistic, noisy",
          padding: "circular",
          prompt: "gouache painting by Kazuo Oga, Studio Ghibli night sky, deep navy sky with soft painted stars, a distant city skyline glowing on the horizon, opaque layered paint",
          seed: 11,
          source: "sky/metropolis-night.paint.jpg",
          steps: 40,
          strength: 0.5,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "sky/sunset-highway.env": {
      bytes: 2978106,
      file: "c1ff7256650ea9619e7793094c7a48b76c72dea8a2da2a9ac5c8aaff20e1db0f.env",
      irradiance_up: [
        0.856604370475066,
        0.6392227223240393,
        0.8665984074907577
      ],
      kind: "hdri-env",
      license: "CC0",
      note: "sun disc clamped out of the IBL; add it back as a Babylon DirectionalLight: direction -sun_dir, diffuse*intensity = sun_light_rgb",
      object_exposure: 1.4247965619962584,
      prefilter: {
        babylon: "9.31.0",
        cube_size: 512,
        engine: "WebGPU",
        imageType: "image/png",
        tool: "BABYLON.EnvironmentTextureTools.CreateEnvTextureAsync"
      },
      sha256: "c1ff7256650ea9619e7793094c7a48b76c72dea8a2da2a9ac5c8aaff20e1db0f",
      source: {
        polyhaven: {
          id: "the_sky_is_on_fire",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/the_sky_is_on_fire_2k.hdr"
        }
      },
      sun_clamp: 29.262733459472656,
      sun_dir: [
        0.9802420324048428,
        0.04140564097707671,
        -0.19341957192099354
      ],
      sun_illuminance_rgb: [
        0,
        0,
        0
      ],
      sun_light_rgb: [
        0,
        0,
        0
      ],
      sun_peak_ratio: 7.793429374694824
    },
    "sky/sunset-highway.jpg": {
      bytes: 189665,
      file: "c64f187d4d3b0552149d4a5deccb696cb9bb29a038b0500540a6175eff4b7fec.jpg",
      kind: "sky",
      license: "CC0",
      projection: "equirectangular",
      sha256: "c64f187d4d3b0552149d4a5deccb696cb9bb29a038b0500540a6175eff4b7fec",
      size: [
        2048,
        1024
      ],
      source: {
        polyhaven: {
          id: "the_sky_is_on_fire",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/the_sky_is_on_fire_2k.hdr"
        }
      },
      tonemap: {
        exposure: 0.24941180862404064,
        jpeg_quality: 88,
        key: 0.18,
        tonemap: "aces-fitted"
      }
    },
    "sky/sunset-highway.paint.jpg": {
      bytes: 160147,
      file: "26212f93648e0e3f25b6d6916b3c369e7f5acf40fdc067affcb7fb7aad94105d.jpg",
      horizon_srgb: [
        0.8725000023841858,
        0.7750999927520752,
        0.6359000205993652
      ],
      kind: "sky",
      license: "CC0",
      note: "painted sky dome: 2048x1024 equirect, horizon at the middle; the game undoes ACES and the exposure when drawing it",
      sha256: "26212f93648e0e3f25b6d6916b3c369e7f5acf40fdc067affcb7fb7aad94105d",
      source: {
        generated: {
          afternoon: [
            [
              70,
              100,
              160
            ],
            [
              236,
              190,
              146
            ]
          ],
          cream: [
            250,
            244,
            228
          ],
          from: "c64f187d4d3b0552149d4a5deccb696cb9bb29a038b0500540a6175eff4b7fec",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, trees, land, mountains, animals, photo, photorealistic, noisy, buildings, city",
          padding: "circular",
          prompt: "gouache sky painting by Kazuo Oga, Studio Ghibli background art, towering white cumulus clouds with warm sunlit tops and soft blue-grey shaded bellies, deep clear sky, opaque layered paint, soft visible brushwork",
          seed: 11,
          source: "sky/sunset-highway.jpg",
          steps: 40,
          strength: 0.7,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "sky/tulip-gardens.env": {
      bytes: 2220921,
      file: "616adf3237dab6ead1e43fa0e78abde430d2d83991f49b917a6fe07964c48377.env",
      irradiance_up: [
        0.4208588771474065,
        0.4566028310015099,
        0.44857849741658934
      ],
      kind: "hdri-env",
      license: "CC0",
      note: "sun disc clamped out of the IBL; add it back as a Babylon DirectionalLight: direction -sun_dir, diffuse*intensity = sun_light_rgb",
      object_exposure: 0.732611063442623,
      prefilter: {
        babylon: "9.31.0",
        cube_size: 512,
        engine: "WebGPU",
        imageType: "image/png",
        tool: "BABYLON.EnvironmentTextureTools.CreateEnvTextureAsync"
      },
      sha256: "616adf3237dab6ead1e43fa0e78abde430d2d83991f49b917a6fe07964c48377",
      source: {
        polyhaven: {
          id: "sunflowers_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/sunflowers_puresky_2k.hdr"
        }
      },
      sun_clamp: 11.199281215667725,
      sun_dir: [
        0.431482469528118,
        0.6821607375105239,
        -0.5903216129272374
      ],
      sun_illuminance_rgb: [
        5.235022124543363,
        4.113339592117116,
        2.3025208214339457
      ],
      sun_light_rgb: [
        1.666359296633024,
        1.3093166574020791,
        0.7329151406064475
      ],
      sun_peak_ratio: 9151.2431640625
    },
    "sky/tulip-gardens.jpg": {
      bytes: 152373,
      file: "190a2351e0198a3f2fdec9e9753888ed2241b2a5e2b4db6088934f3afaa1ea25.jpg",
      kind: "sky",
      license: "CC0",
      projection: "equirectangular",
      sha256: "190a2351e0198a3f2fdec9e9753888ed2241b2a5e2b4db6088934f3afaa1ea25",
      size: [
        2048,
        1024
      ],
      source: {
        polyhaven: {
          id: "sunflowers_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/sunflowers_puresky_2k.hdr"
        }
      },
      tonemap: {
        exposure: 0.5914894123767231,
        jpeg_quality: 88,
        key: 0.18,
        tonemap: "aces-fitted"
      }
    },
    "sky/tulip-gardens.paint.jpg": {
      bytes: 192758,
      file: "e538b9c9250df083417a2ba189d17613288c38c6465f1d9028af7fd8486f0595.jpg",
      horizon_srgb: [
        0.6805999875068665,
        0.7730000019073486,
        0.7893000245094299
      ],
      kind: "sky",
      license: "CC0",
      note: "painted sky dome: 2048x1024 equirect, horizon at the middle; the game undoes ACES and the exposure when drawing it",
      sha256: "e538b9c9250df083417a2ba189d17613288c38c6465f1d9028af7fd8486f0595",
      source: {
        generated: {
          afternoon: [
            [
              62,
              120,
              178
            ],
            [
              170,
              202,
              208
            ]
          ],
          cream: [
            250,
            244,
            228
          ],
          from: "190a2351e0198a3f2fdec9e9753888ed2241b2a5e2b4db6088934f3afaa1ea25",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, trees, land, mountains, animals, photo, photorealistic, noisy, buildings, city",
          padding: "circular",
          prompt: "gouache sky painting by Kazuo Oga, Studio Ghibli background art, towering white cumulus clouds with warm sunlit tops and soft blue-grey shaded bellies, deep clear sky, opaque layered paint, soft visible brushwork",
          seed: 11,
          source: "sky/tulip-gardens.jpg",
          steps: 40,
          strength: 0.7,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "sky/wilderness-run.env": {
      bytes: 1827720,
      file: "facec0aa63f0c8dfd29d290912ecf62b37056288540ac6ae470fc080631082be.env",
      irradiance_up: [
        1.0751929728979674,
        1.157815940110003,
        1.3470144501086654
      ],
      kind: "hdri-env",
      license: "CC0",
      note: "sun disc clamped out of the IBL; add it back as a Babylon DirectionalLight: direction -sun_dir, diffuse*intensity = sun_light_rgb",
      object_exposure: 0.8666183910459223,
      prefilter: {
        babylon: "9.31.0",
        cube_size: 512,
        engine: "WebGPU",
        imageType: "image/png",
        tool: "BABYLON.EnvironmentTextureTools.CreateEnvTextureAsync"
      },
      sha256: "facec0aa63f0c8dfd29d290912ecf62b37056288540ac6ae470fc080631082be",
      source: {
        polyhaven: {
          id: "kloofendal_overcast_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_overcast_puresky_2k.hdr"
        }
      },
      sun_clamp: 42.00606346130371,
      sun_dir: [
        0.49690583506806363,
        0.3869310055143887,
        -0.7767682975295365
      ],
      sun_illuminance_rgb: [
        0,
        0,
        0
      ],
      sun_light_rgb: [
        0,
        0,
        0
      ],
      sun_peak_ratio: 5.175085544586182
    },
    "sky/wilderness-run.jpg": {
      bytes: 81316,
      file: "c8e25abdceea4b0ac9197837e8971be3fa824cbaa4f3c7ecfeed52816706cb10.jpg",
      kind: "sky",
      license: "CC0",
      projection: "equirectangular",
      sha256: "c8e25abdceea4b0ac9197837e8971be3fa824cbaa4f3c7ecfeed52816706cb10",
      size: [
        2048,
        1024
      ],
      source: {
        polyhaven: {
          id: "kloofendal_overcast_puresky",
          res: "2k",
          url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_overcast_puresky_2k.hdr"
        }
      },
      tonemap: {
        exposure: 0.15987969867491292,
        jpeg_quality: 88,
        key: 0.18,
        tonemap: "aces-fitted"
      }
    },
    "sky/wilderness-run.paint.jpg": {
      bytes: 169822,
      file: "fe59d3228173e52a6e6153f6f07b6be4db2463713ca83d693ae42520e267b10d.jpg",
      horizon_srgb: [
        0.6050999760627747,
        0.7527999877929688,
        0.7610999941825867
      ],
      kind: "sky",
      license: "CC0",
      note: "painted sky dome: 2048x1024 equirect, horizon at the middle; the game undoes ACES and the exposure when drawing it",
      sha256: "fe59d3228173e52a6e6153f6f07b6be4db2463713ca83d693ae42520e267b10d",
      source: {
        generated: {
          afternoon: [
            [
              62,
              120,
              178
            ],
            [
              170,
              202,
              208
            ]
          ],
          cream: [
            250,
            244,
            228
          ],
          from: "c8e25abdceea4b0ac9197837e8971be3fa824cbaa4f3c7ecfeed52816706cb10",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          negative: "text, watermark, logo, people, trees, land, mountains, animals, photo, photorealistic, noisy, buildings, city",
          padding: "circular",
          prompt: "gouache sky painting by Kazuo Oga, Studio Ghibli background art, towering white cumulus clouds with warm sunlit tops and soft blue-grey shaded bellies, deep clear sky, opaque layered paint, soft visible brushwork",
          seed: 11,
          source: "sky/wilderness-run.jpg",
          steps: 40,
          strength: 0.7,
          vae: "madebyollin/sdxl-vae-fp16-fix"
        }
      }
    },
    "tex/asphalt/albedo": {
      bytes: 63320,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "ab542a65cb57acef4088f594ee131c034e7ccba8a91d3e863efab3d666253d3c.webp",
      kind: "texture",
      license: "CC0",
      sha256: "ab542a65cb57acef4088f594ee131c034e7ccba8a91d3e863efab3d666253d3c",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              200,
              16,
              0.3
            ],
            fine: 2,
            palette: [
              [
                "#2B2826",
                0.35
              ],
              [
                "#302D2A",
                0.45
              ],
              [
                "#36322E",
                0.2
              ]
            ],
            rough: 0.9,
            scale: 180,
            seed: 45
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/asphalt/arm": {
      bytes: 7546,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "13065f84ddefb44435fa046a7d5d12f8bb4bd423d0b54ab3bec0dec0c6ae1a5f.webp",
      kind: "texture",
      license: "CC0",
      sha256: "13065f84ddefb44435fa046a7d5d12f8bb4bd423d0b54ab3bec0dec0c6ae1a5f",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              200,
              16,
              0.3
            ],
            fine: 2,
            palette: [
              [
                "#2B2826",
                0.35
              ],
              [
                "#302D2A",
                0.45
              ],
              [
                "#36322E",
                0.2
              ]
            ],
            rough: 0.9,
            scale: 180,
            seed: 45
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/asphalt/normal": {
      bytes: 1292560,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 2048
      },
      file: "94ba499c2ba7af6a4620e35da0200ae22c31b4d6b1d96e78d4ba4cc7f6bf95c9.webp",
      kind: "texture",
      license: "CC0",
      sha256: "94ba499c2ba7af6a4620e35da0200ae22c31b4d6b1d96e78d4ba4cc7f6bf95c9",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              200,
              16,
              0.3
            ],
            fine: 2,
            palette: [
              [
                "#2B2826",
                0.35
              ],
              [
                "#302D2A",
                0.45
              ],
              [
                "#36322E",
                0.2
              ]
            ],
            rough: 0.9,
            scale: 180,
            seed: 45
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/cobble/albedo": {
      bytes: 322368,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "6bb068b5697eeb7c32c74d97f73ea0ca04f7398c08381f937031863cf8b649d5.webp",
      kind: "texture",
      license: "CC0",
      sha256: "6bb068b5697eeb7c32c74d97f73ea0ca04f7398c08381f937031863cf8b649d5",
      source: {
        generated: {
          from: "6491c89ecf2349aabf197d6ee9dc7aa0e8f576c6b626837a29a284aa5837fc77",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
          negative: "flowers, blossoms, petals, leaves, branches, twigs, plants, objects, photo, photorealistic, noise, grain, speckles, film grain, text, watermark, logo, perspective, horizon, sky, people, animals, blurry, lowres, 3d render, plastic, miniature, model railway, pattern, wallpaper, decorative, gaps, loose stones",
          padding: "circular",
          post: [
            "lanczos 1024",
            "mean shift on 3x3 wrap (spatial 1, colour 1)",
            "stroke noise 24x6 px at three angles, patch-picked (160 px), +-20 sRGB levels (seed 17)",
            "sdxl img2img at 1024",
            "wrapped lanczos to 2048",
            "wrapped bilateral (d 9, colour 16, space 5)",
            "sRGB per-channel mean to the source's, spread 0.9x the source's std",
            "linear per-channel mean scaled to the source's"
          ],
          prompt: "flat seamless ground texture seen from directly above, painted in opaque gouache in the style of Studio Ghibli background art, soft visible brush strokes, uniform coverage, no objects, painted cobblestone street, rounded setts in warm greys with soft painted joints",
          seed: 3,
          steps: 40,
          strength: 0.55,
          vae: "madebyollin/sdxl-vae-fp16-fix",
          vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd"
        }
      }
    },
    "tex/cobble/arm": {
      bytes: 70896,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "e7c926670f7c33fe84a1535f7867263eda3a31f96b8eaa7261472d04e336a865.webp",
      kind: "texture",
      license: "CC0",
      sha256: "e7c926670f7c33fe84a1535f7867263eda3a31f96b8eaa7261472d04e336a865",
      source: {
        generated: {
          from: "6491c89ecf2349aabf197d6ee9dc7aa0e8f576c6b626837a29a284aa5837fc77",
          from_albedo: "3ed407a1e037cbe523b00e2b19face7e0a4e3c449409a29f6dda546911da18cd",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
          negative: "flowers, blossoms, petals, leaves, branches, twigs, plants, objects, photo, photorealistic, noise, grain, speckles, film grain, text, watermark, logo, perspective, horizon, sky, people, animals, blurry, lowres, 3d render, plastic, miniature, model railway, pattern, wallpaper, decorative, gaps, loose stones",
          padding: "circular",
          post: [
            "lanczos 1024",
            "mean shift on 3x3 wrap (spatial 1, colour 1)",
            "stroke noise 24x6 px at three angles, patch-picked (160 px), +-20 sRGB levels (seed 17)",
            "sdxl img2img at 1024",
            "wrapped lanczos to 2048",
            "wrapped bilateral (d 9, colour 16, space 5)",
            "sRGB per-channel mean to the source's, spread 0.9x the source's std",
            "linear per-channel mean scaled to the source's",
            "height as the normal's, at 2048, standardised",
            "R: AO = 1 - 0.12 x cavity (wrapped gaussian 24 px minus height), clamped to [0.82, 1]",
            "G: roughness 0.85 - 0.02 x height, B: metallic 0"
          ],
          prompt: "flat seamless ground texture seen from directly above, painted in opaque gouache in the style of Studio Ghibli background art, soft visible brush strokes, uniform coverage, no objects, painted cobblestone street, rounded setts in warm greys with soft painted joints",
          seed: 3,
          steps: 40,
          strength: 0.55,
          vae: "madebyollin/sdxl-vae-fp16-fix",
          vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd"
        }
      }
    },
    "tex/cobble/normal": {
      bytes: 482658,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 1024
      },
      file: "8026ca34eb7feae971ae561fdcb7255da2430c85ccce427acdb082caf2bc7c1f.webp",
      kind: "texture",
      license: "CC0",
      sha256: "8026ca34eb7feae971ae561fdcb7255da2430c85ccce427acdb082caf2bc7c1f",
      source: {
        generated: {
          from: "6491c89ecf2349aabf197d6ee9dc7aa0e8f576c6b626837a29a284aa5837fc77",
          from_albedo: "3ed407a1e037cbe523b00e2b19face7e0a4e3c449409a29f6dda546911da18cd",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
          negative: "flowers, blossoms, petals, leaves, branches, twigs, plants, objects, photo, photorealistic, noise, grain, speckles, film grain, text, watermark, logo, perspective, horizon, sky, people, animals, blurry, lowres, 3d render, plastic, miniature, model railway, pattern, wallpaper, decorative, gaps, loose stones",
          padding: "circular",
          post: [
            "lanczos 1024",
            "mean shift on 3x3 wrap (spatial 1, colour 1)",
            "stroke noise 24x6 px at three angles, patch-picked (160 px), +-20 sRGB levels (seed 17)",
            "sdxl img2img at 1024",
            "wrapped lanczos to 2048",
            "wrapped bilateral (d 9, colour 16, space 5)",
            "sRGB per-channel mean to the source's, spread 0.9x the source's std",
            "linear per-channel mean scaled to the source's",
            "height: albedo luminance at 1024, wrapped gaussian band-pass (sigma 2 minus 96 px)",
            "OpenGL (+Y) normal by central differences, rms slope 0.1"
          ],
          prompt: "flat seamless ground texture seen from directly above, painted in opaque gouache in the style of Studio Ghibli background art, soft visible brush strokes, uniform coverage, no objects, painted cobblestone street, rounded setts in warm greys with soft painted joints",
          seed: 3,
          steps: 40,
          strength: 0.55,
          vae: "madebyollin/sdxl-vae-fp16-fix",
          vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd"
        }
      }
    },
    "tex/field-soil/albedo": {
      bytes: 177956,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "c2d8706513c49ef13912b7d3a55012841913a986a1091749816b965f977c82d4.webp",
      kind: "texture",
      license: "CC0",
      sha256: "c2d8706513c49ef13912b7d3a55012841913a986a1091749816b965f977c82d4",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              160,
              16,
              0.3
            ],
            fine: 8,
            palette: [
              [
                "#8E5F38",
                0.3
              ],
              [
                "#A87448",
                0.45
              ],
              [
                "#BF8C5A",
                0.25
              ]
            ],
            rough: 0.96,
            scale: 100,
            seed: 39
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/field-soil/arm": {
      bytes: 7544,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "f3d212df076f19816132120e762826329a0fe343795e5f3c4f21cfabf4afc4e6.webp",
      kind: "texture",
      license: "CC0",
      sha256: "f3d212df076f19816132120e762826329a0fe343795e5f3c4f21cfabf4afc4e6",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              160,
              16,
              0.3
            ],
            fine: 8,
            palette: [
              [
                "#8E5F38",
                0.3
              ],
              [
                "#A87448",
                0.45
              ],
              [
                "#BF8C5A",
                0.25
              ]
            ],
            rough: 0.96,
            scale: 100,
            seed: 39
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/field-soil/normal": {
      bytes: 494720,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 1024
      },
      file: "51de8798336d5d09488e74283ba395da8d4d7ccd798bd674c27ef8ba18abc216.webp",
      kind: "texture",
      license: "CC0",
      sha256: "51de8798336d5d09488e74283ba395da8d4d7ccd798bd674c27ef8ba18abc216",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              160,
              16,
              0.3
            ],
            fine: 8,
            palette: [
              [
                "#8E5F38",
                0.3
              ],
              [
                "#A87448",
                0.45
              ],
              [
                "#BF8C5A",
                0.25
              ]
            ],
            rough: 0.96,
            scale: 100,
            seed: 39
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/forest-floor/albedo": {
      bytes: 148218,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "630e1633221ccb10b320b1e76e5553a0c61197e7726a58cefdd3fd1f707ed2f9.webp",
      kind: "texture",
      license: "CC0",
      sha256: "630e1633221ccb10b320b1e76e5553a0c61197e7726a58cefdd3fd1f707ed2f9",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              60,
              16,
              0.3
            ],
            fine: 8,
            palette: [
              [
                "#4E6A3C",
                0.35
              ],
              [
                "#5E7A44",
                0.4
              ],
              [
                "#7A7E4C",
                0.25
              ]
            ],
            rough: 0.95,
            scale: 80,
            seed: 37
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/forest-floor/arm": {
      bytes: 7544,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "03f3a55f58fa4f3123d5b0e15302855bb9739252144298bfbaf31a7d19aabcb1.webp",
      kind: "texture",
      license: "CC0",
      sha256: "03f3a55f58fa4f3123d5b0e15302855bb9739252144298bfbaf31a7d19aabcb1",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              60,
              16,
              0.3
            ],
            fine: 8,
            palette: [
              [
                "#4E6A3C",
                0.35
              ],
              [
                "#5E7A44",
                0.4
              ],
              [
                "#7A7E4C",
                0.25
              ]
            ],
            rough: 0.95,
            scale: 80,
            seed: 37
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/forest-floor/normal": {
      bytes: 498754,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 1024
      },
      file: "903f217d31c52d973d99c9e18de234b80f5fa7beda88a2ba3d393ed98324eeb9.webp",
      kind: "texture",
      license: "CC0",
      sha256: "903f217d31c52d973d99c9e18de234b80f5fa7beda88a2ba3d393ed98324eeb9",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              60,
              16,
              0.3
            ],
            fine: 8,
            palette: [
              [
                "#4E6A3C",
                0.35
              ],
              [
                "#5E7A44",
                0.4
              ],
              [
                "#7A7E4C",
                0.25
              ]
            ],
            rough: 0.95,
            scale: 80,
            seed: 37
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/grass/albedo": {
      bytes: 175590,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "5d682223ac682c3ca2d757d30a42301ebd3d8b4379a3c35b47ac27b9acbe8027.webp",
      kind: "texture",
      license: "CC0",
      sha256: "5d682223ac682c3ca2d757d30a42301ebd3d8b4379a3c35b47ac27b9acbe8027",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              60,
              12,
              0.3
            ],
            fine: 8,
            palette: [
              [
                "#5E7A48",
                0.25
              ],
              [
                "#6E8A52",
                0.4
              ],
              [
                "#80985C",
                0.25
              ],
              [
                "#94A46C",
                0.1
              ]
            ],
            rough: 0.95,
            scale: 90,
            seed: 35
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/grass/arm": {
      bytes: 7544,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "03f3a55f58fa4f3123d5b0e15302855bb9739252144298bfbaf31a7d19aabcb1.webp",
      kind: "texture",
      license: "CC0",
      sha256: "03f3a55f58fa4f3123d5b0e15302855bb9739252144298bfbaf31a7d19aabcb1",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              60,
              12,
              0.3
            ],
            fine: 8,
            palette: [
              [
                "#5E7A48",
                0.25
              ],
              [
                "#6E8A52",
                0.4
              ],
              [
                "#80985C",
                0.25
              ],
              [
                "#94A46C",
                0.1
              ]
            ],
            rough: 0.95,
            scale: 90,
            seed: 35
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/grass/normal": {
      bytes: 498594,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 1024
      },
      file: "97a455f7281b41b34727bd896d466f4c639a18074cfbf660fe83b9a3cbea60a1.webp",
      kind: "texture",
      license: "CC0",
      sha256: "97a455f7281b41b34727bd896d466f4c639a18074cfbf660fe83b9a3cbea60a1",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              60,
              12,
              0.3
            ],
            fine: 8,
            palette: [
              [
                "#5E7A48",
                0.25
              ],
              [
                "#6E8A52",
                0.4
              ],
              [
                "#80985C",
                0.25
              ],
              [
                "#94A46C",
                0.1
              ]
            ],
            rough: 0.95,
            scale: 90,
            seed: 35
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/palm-bark/albedo": {
      bytes: 89540,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "d41572ebcc16b7a03f8bec616c4ba0f150fbc8cff9baa00c112996bc4dcb09bd.webp",
      kind: "texture",
      license: "CC0",
      sha256: "d41572ebcc16b7a03f8bec616c4ba0f150fbc8cff9baa00c112996bc4dcb09bd",
      source: {
        generated: {
          from: "c6538d21efed06c49144ef44f316e3049c1e470aab8b12d921cf05bc461002d2",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
          negative: "photo, photorealistic, noise, grain, speckles, film grain, jpeg artifacts, text, watermark, logo, perspective, horizon, sky, aerial landscape, diorama, miniature, trees, shadows of objects, people, animals, blurry, lowres, tree, trunk, column, pillar, spiral, rope, background, frame, border, stones, pebbles, holes, spots",
          padding: "circular",
          post: [
            "lanczos 1024",
            "mean shift on 3x3 wrap (spatial 10, colour 18)",
            "sdxl img2img at 1024",
            "wrapped lanczos to 2048",
            "wrapped bilateral (d 9, colour 16, space 5)",
            "sRGB per-channel mean to the source's, spread 1.0x the source's std",
            "linear per-channel mean scaled to the source's"
          ],
          prompt: "stylized hand-painted game texture, seamless top-down view, clean painterly shapes, soft gradients, smooth rounded forms, cartoon, Breath of the Wild style, Mario Kart 8 style, flat bark texture filling the frame, brown palm bark surface with fibrous bands and soft ridges",
          seed: 19,
          steps: 40,
          strength: 0.35,
          vae: "madebyollin/sdxl-vae-fp16-fix",
          vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd"
        }
      }
    },
    "tex/palm-bark/arm": {
      bytes: 39738,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "13aa7d18f30e05a5d101db2a7baa90e181221a21560b8cf83b127914d7bfd6fa.webp",
      kind: "texture",
      license: "CC0",
      sha256: "13aa7d18f30e05a5d101db2a7baa90e181221a21560b8cf83b127914d7bfd6fa",
      source: {
        generated: {
          from: "c6538d21efed06c49144ef44f316e3049c1e470aab8b12d921cf05bc461002d2",
          from_albedo: "358861837569fcde24b90c685396df794a9ea297e538cc4b94070f0dcc98b71e",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
          negative: "photo, photorealistic, noise, grain, speckles, film grain, jpeg artifacts, text, watermark, logo, perspective, horizon, sky, aerial landscape, diorama, miniature, trees, shadows of objects, people, animals, blurry, lowres, tree, trunk, column, pillar, spiral, rope, background, frame, border, stones, pebbles, holes, spots",
          padding: "circular",
          post: [
            "lanczos 1024",
            "mean shift on 3x3 wrap (spatial 10, colour 18)",
            "sdxl img2img at 1024",
            "wrapped lanczos to 2048",
            "wrapped bilateral (d 9, colour 16, space 5)",
            "sRGB per-channel mean to the source's, spread 1.0x the source's std",
            "linear per-channel mean scaled to the source's",
            "height as the normal's, at 2048, standardised",
            "R: AO = 1 - 0.12 x cavity (wrapped gaussian 24 px minus height), clamped to [0.82, 1]",
            "G: roughness 0.85 - 0.02 x height, B: metallic 0"
          ],
          prompt: "stylized hand-painted game texture, seamless top-down view, clean painterly shapes, soft gradients, smooth rounded forms, cartoon, Breath of the Wild style, Mario Kart 8 style, flat bark texture filling the frame, brown palm bark surface with fibrous bands and soft ridges",
          seed: 19,
          steps: 40,
          strength: 0.35,
          vae: "madebyollin/sdxl-vae-fp16-fix",
          vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd"
        }
      }
    },
    "tex/palm-bark/normal": {
      bytes: 547166,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 1024
      },
      file: "a837def93fb2b2f410a4437d46d2e499ce024e78d186cd05e84711d2b72f4e0a.webp",
      kind: "texture",
      license: "CC0",
      sha256: "a837def93fb2b2f410a4437d46d2e499ce024e78d186cd05e84711d2b72f4e0a",
      source: {
        generated: {
          from: "c6538d21efed06c49144ef44f316e3049c1e470aab8b12d921cf05bc461002d2",
          from_albedo: "358861837569fcde24b90c685396df794a9ea297e538cc4b94070f0dcc98b71e",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
          negative: "photo, photorealistic, noise, grain, speckles, film grain, jpeg artifacts, text, watermark, logo, perspective, horizon, sky, aerial landscape, diorama, miniature, trees, shadows of objects, people, animals, blurry, lowres, tree, trunk, column, pillar, spiral, rope, background, frame, border, stones, pebbles, holes, spots",
          padding: "circular",
          post: [
            "lanczos 1024",
            "mean shift on 3x3 wrap (spatial 10, colour 18)",
            "sdxl img2img at 1024",
            "wrapped lanczos to 2048",
            "wrapped bilateral (d 9, colour 16, space 5)",
            "sRGB per-channel mean to the source's, spread 1.0x the source's std",
            "linear per-channel mean scaled to the source's",
            "height: albedo luminance at 1024, wrapped gaussian band-pass (sigma 2 minus 96 px)",
            "OpenGL (+Y) normal by central differences, rms slope 0.14"
          ],
          prompt: "stylized hand-painted game texture, seamless top-down view, clean painterly shapes, soft gradients, smooth rounded forms, cartoon, Breath of the Wild style, Mario Kart 8 style, flat bark texture filling the frame, brown palm bark surface with fibrous bands and soft ridges",
          seed: 19,
          steps: 40,
          strength: 0.35,
          vae: "madebyollin/sdxl-vae-fp16-fix",
          vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd"
        }
      }
    },
    "tex/rock-canyon/albedo": {
      bytes: 138316,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "2e8a621462b68ec48c677d0b72a1d38ad85c532a8ece64d489d56df4184d3fd7.webp",
      kind: "texture",
      license: "CC0",
      sha256: "2e8a621462b68ec48c677d0b72a1d38ad85c532a8ece64d489d56df4184d3fd7",
      source: {
        generated: {
          from: "b74cacc16c869f65ae1913f5da8f4e793131d6020ad06c66014d32c3ba8de025",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
          negative: "flowers, blossoms, petals, leaves, branches, twigs, plants, objects, photo, photorealistic, noise, grain, speckles, film grain, text, watermark, logo, perspective, horizon, sky, people, animals, blurry, lowres, 3d render, plastic, miniature, model railway, pattern, wallpaper, decorative, plants",
          padding: "circular",
          post: [
            "lanczos 1024",
            "mean shift on 3x3 wrap (spatial 1, colour 1)",
            "stroke noise 140x18 px at three angles, patch-picked (160 px), +-22 sRGB levels (seed 17)",
            "sdxl img2img at 1024",
            "wrapped lanczos to 2048",
            "wrapped bilateral (d 9, colour 16, space 5)",
            "sRGB per-channel mean to the source's, spread 1.0x the source's std",
            "linear per-channel mean scaled to the source's"
          ],
          prompt: "flat seamless ground texture seen from directly above, painted in opaque gouache in the style of Studio Ghibli background art, soft visible brush strokes, uniform coverage, no objects, painted red sandstone rock face, soft horizontal strata in warm opaque gouache",
          seed: 21,
          steps: 40,
          strength: 0.45,
          vae: "madebyollin/sdxl-vae-fp16-fix",
          vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd"
        }
      }
    },
    "tex/rock-canyon/arm": {
      bytes: 50580,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "9c1ef9ba5e0f4a1fed4698c6dc85e780c3bfa9e0ac7af02ed89b226f937a206a.webp",
      kind: "texture",
      license: "CC0",
      sha256: "9c1ef9ba5e0f4a1fed4698c6dc85e780c3bfa9e0ac7af02ed89b226f937a206a",
      source: {
        generated: {
          from: "b74cacc16c869f65ae1913f5da8f4e793131d6020ad06c66014d32c3ba8de025",
          from_albedo: "769a26836b31e9580aab6414b4d3db15e51318e0074075768397cd5947312ffa",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
          negative: "flowers, blossoms, petals, leaves, branches, twigs, plants, objects, photo, photorealistic, noise, grain, speckles, film grain, text, watermark, logo, perspective, horizon, sky, people, animals, blurry, lowres, 3d render, plastic, miniature, model railway, pattern, wallpaper, decorative, plants",
          padding: "circular",
          post: [
            "lanczos 1024",
            "mean shift on 3x3 wrap (spatial 1, colour 1)",
            "stroke noise 140x18 px at three angles, patch-picked (160 px), +-22 sRGB levels (seed 17)",
            "sdxl img2img at 1024",
            "wrapped lanczos to 2048",
            "wrapped bilateral (d 9, colour 16, space 5)",
            "sRGB per-channel mean to the source's, spread 1.0x the source's std",
            "linear per-channel mean scaled to the source's",
            "height as the normal's, at 2048, standardised",
            "R: AO = 1 - 0.12 x cavity (wrapped gaussian 24 px minus height), clamped to [0.82, 1]",
            "G: roughness 0.9 - 0.02 x height, B: metallic 0"
          ],
          prompt: "flat seamless ground texture seen from directly above, painted in opaque gouache in the style of Studio Ghibli background art, soft visible brush strokes, uniform coverage, no objects, painted red sandstone rock face, soft horizontal strata in warm opaque gouache",
          seed: 21,
          steps: 40,
          strength: 0.45,
          vae: "madebyollin/sdxl-vae-fp16-fix",
          vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd"
        }
      }
    },
    "tex/rock-canyon/normal": {
      bytes: 384650,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 1024
      },
      file: "4329c2b6cc9a98e88f5e48ad5b4f58250442e11cc10635102582b09350142445.webp",
      kind: "texture",
      license: "CC0",
      sha256: "4329c2b6cc9a98e88f5e48ad5b4f58250442e11cc10635102582b09350142445",
      source: {
        generated: {
          from: "b74cacc16c869f65ae1913f5da8f4e793131d6020ad06c66014d32c3ba8de025",
          from_albedo: "769a26836b31e9580aab6414b4d3db15e51318e0074075768397cd5947312ffa",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
          negative: "flowers, blossoms, petals, leaves, branches, twigs, plants, objects, photo, photorealistic, noise, grain, speckles, film grain, text, watermark, logo, perspective, horizon, sky, people, animals, blurry, lowres, 3d render, plastic, miniature, model railway, pattern, wallpaper, decorative, plants",
          padding: "circular",
          post: [
            "lanczos 1024",
            "mean shift on 3x3 wrap (spatial 1, colour 1)",
            "stroke noise 140x18 px at three angles, patch-picked (160 px), +-22 sRGB levels (seed 17)",
            "sdxl img2img at 1024",
            "wrapped lanczos to 2048",
            "wrapped bilateral (d 9, colour 16, space 5)",
            "sRGB per-channel mean to the source's, spread 1.0x the source's std",
            "linear per-channel mean scaled to the source's",
            "height: albedo luminance at 1024, wrapped gaussian band-pass (sigma 2 minus 96 px)",
            "OpenGL (+Y) normal by central differences, rms slope 0.1"
          ],
          prompt: "flat seamless ground texture seen from directly above, painted in opaque gouache in the style of Studio Ghibli background art, soft visible brush strokes, uniform coverage, no objects, painted red sandstone rock face, soft horizontal strata in warm opaque gouache",
          seed: 21,
          steps: 40,
          strength: 0.45,
          vae: "madebyollin/sdxl-vae-fp16-fix",
          vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd"
        }
      }
    },
    "tex/rock-granite/albedo": {
      bytes: 155454,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "e39c9f2e75e114425f1cea9e065816ec056e668177e397e5af5649dd16113a25.webp",
      kind: "texture",
      license: "CC0",
      sha256: "e39c9f2e75e114425f1cea9e065816ec056e668177e397e5af5649dd16113a25",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              70,
              20,
              0.3
            ],
            fine: 7,
            palette: [
              [
                "#8E949A",
                0.3
              ],
              [
                "#A9AEB2",
                0.45
              ],
              [
                "#C4C6C4",
                0.25
              ]
            ],
            rough: 0.9,
            scale: 90,
            seed: 41
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/rock-granite/arm": {
      bytes: 7546,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "13065f84ddefb44435fa046a7d5d12f8bb4bd423d0b54ab3bec0dec0c6ae1a5f.webp",
      kind: "texture",
      license: "CC0",
      sha256: "13065f84ddefb44435fa046a7d5d12f8bb4bd423d0b54ab3bec0dec0c6ae1a5f",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              70,
              20,
              0.3
            ],
            fine: 7,
            palette: [
              [
                "#8E949A",
                0.3
              ],
              [
                "#A9AEB2",
                0.45
              ],
              [
                "#C4C6C4",
                0.25
              ]
            ],
            rough: 0.9,
            scale: 90,
            seed: 41
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/rock-granite/normal": {
      bytes: 497920,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 1024
      },
      file: "5c67aaf21df0cd3b296a3bae6e22050b0052823f6354fef59f9e30ff8778c6d5.webp",
      kind: "texture",
      license: "CC0",
      sha256: "5c67aaf21df0cd3b296a3bae6e22050b0052823f6354fef59f9e30ff8778c6d5",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              70,
              20,
              0.3
            ],
            fine: 7,
            palette: [
              [
                "#8E949A",
                0.3
              ],
              [
                "#A9AEB2",
                0.45
              ],
              [
                "#C4C6C4",
                0.25
              ]
            ],
            rough: 0.9,
            scale: 90,
            seed: 41
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/ruins-stone/albedo": {
      bytes: 142296,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "001b95bfef76933555be3173d7d9af93a43b2d8dc79de37037614925d75c4cf3.webp",
      kind: "texture",
      license: "CC0",
      sha256: "001b95bfef76933555be3173d7d9af93a43b2d8dc79de37037614925d75c4cf3",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              60,
              18,
              0.3
            ],
            fine: 6,
            palette: [
              [
                "#B89A72",
                0.3
              ],
              [
                "#CDB088",
                0.45
              ],
              [
                "#DDC5A0",
                0.25
              ]
            ],
            rough: 0.9,
            scale: 90,
            seed: 43
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/ruins-stone/arm": {
      bytes: 7546,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "13065f84ddefb44435fa046a7d5d12f8bb4bd423d0b54ab3bec0dec0c6ae1a5f.webp",
      kind: "texture",
      license: "CC0",
      sha256: "13065f84ddefb44435fa046a7d5d12f8bb4bd423d0b54ab3bec0dec0c6ae1a5f",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              60,
              18,
              0.3
            ],
            fine: 6,
            palette: [
              [
                "#B89A72",
                0.3
              ],
              [
                "#CDB088",
                0.45
              ],
              [
                "#DDC5A0",
                0.25
              ]
            ],
            rough: 0.9,
            scale: 90,
            seed: 43
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/ruins-stone/normal": {
      bytes: 501284,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 1024
      },
      file: "5ab547bfea4bcf5a5b06a0cb8c672365bfb55a63b52632d5f718b012d1adbaab.webp",
      kind: "texture",
      license: "CC0",
      sha256: "5ab547bfea4bcf5a5b06a0cb8c672365bfb55a63b52632d5f718b012d1adbaab",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              60,
              18,
              0.3
            ],
            fine: 6,
            palette: [
              [
                "#B89A72",
                0.3
              ],
              [
                "#CDB088",
                0.45
              ],
              [
                "#DDC5A0",
                0.25
              ]
            ],
            rough: 0.9,
            scale: 90,
            seed: 43
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/sand-beach/albedo": {
      bytes: 111210,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "df8936d19d6bef17c283d346d385b296a75271425a89ff1c8185e6ba15f924cd.webp",
      kind: "texture",
      license: "CC0",
      sha256: "df8936d19d6bef17c283d346d385b296a75271425a89ff1c8185e6ba15f924cd",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              120,
              18,
              0.3
            ],
            fine: 5,
            palette: [
              [
                "#CDBB98",
                0.25
              ],
              [
                "#DBCCAA",
                0.4
              ],
              [
                "#E7DCC0",
                0.35
              ]
            ],
            rough: 0.95,
            scale: 120,
            seed: 33
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/sand-beach/arm": {
      bytes: 7544,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "03f3a55f58fa4f3123d5b0e15302855bb9739252144298bfbaf31a7d19aabcb1.webp",
      kind: "texture",
      license: "CC0",
      sha256: "03f3a55f58fa4f3123d5b0e15302855bb9739252144298bfbaf31a7d19aabcb1",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              120,
              18,
              0.3
            ],
            fine: 5,
            palette: [
              [
                "#CDBB98",
                0.25
              ],
              [
                "#DBCCAA",
                0.4
              ],
              [
                "#E7DCC0",
                0.35
              ]
            ],
            rough: 0.95,
            scale: 120,
            seed: 33
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/sand-beach/normal": {
      bytes: 492446,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 1024
      },
      file: "0d1c1af14132e42ab12a2c4957d17dd4dc1bf8e222826f542efda28dcd45ff39.webp",
      kind: "texture",
      license: "CC0",
      sha256: "0d1c1af14132e42ab12a2c4957d17dd4dc1bf8e222826f542efda28dcd45ff39",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              120,
              18,
              0.3
            ],
            fine: 5,
            palette: [
              [
                "#CDBB98",
                0.25
              ],
              [
                "#DBCCAA",
                0.4
              ],
              [
                "#E7DCC0",
                0.35
              ]
            ],
            rough: 0.95,
            scale: 120,
            seed: 33
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/sand-desert/albedo": {
      bytes: 181020,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "5f6c2dbc4d2d231856cc9ddd8884fa7fbb42d1e4feb482df0eeef7e2ebaac85d.webp",
      kind: "texture",
      license: "CC0",
      sha256: "5f6c2dbc4d2d231856cc9ddd8884fa7fbb42d1e4feb482df0eeef7e2ebaac85d",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              140,
              20,
              0.3
            ],
            fine: 7,
            palette: [
              [
                "#8E5A44",
                0.25
              ],
              [
                "#A46C52",
                0.35
              ],
              [
                "#B07E62",
                0.25
              ],
              [
                "#727248",
                0.15
              ]
            ],
            rough: 0.95,
            scale: 110,
            seed: 31
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/sand-desert/arm": {
      bytes: 7544,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "03f3a55f58fa4f3123d5b0e15302855bb9739252144298bfbaf31a7d19aabcb1.webp",
      kind: "texture",
      license: "CC0",
      sha256: "03f3a55f58fa4f3123d5b0e15302855bb9739252144298bfbaf31a7d19aabcb1",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              140,
              20,
              0.3
            ],
            fine: 7,
            palette: [
              [
                "#8E5A44",
                0.25
              ],
              [
                "#A46C52",
                0.35
              ],
              [
                "#B07E62",
                0.25
              ],
              [
                "#727248",
                0.15
              ]
            ],
            rough: 0.95,
            scale: 110,
            seed: 31
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/sand-desert/normal": {
      bytes: 509450,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 1024
      },
      file: "f42e463790e3755391c5d09c290dd02387d7f5465687e9e5a00512a687cf90ad.webp",
      kind: "texture",
      license: "CC0",
      sha256: "f42e463790e3755391c5d09c290dd02387d7f5465687e9e5a00512a687cf90ad",
      source: {
        procedural: {
          builder: "flat",
          params: {
            edge: [
              140,
              20,
              0.3
            ],
            fine: 7,
            palette: [
              [
                "#8E5A44",
                0.25
              ],
              [
                "#A46C52",
                0.35
              ],
              [
                "#B07E62",
                0.25
              ],
              [
                "#727248",
                0.15
              ]
            ],
            rough: 0.95,
            scale: 110,
            seed: 31
          },
          script: "ghibli/textures/flat.py"
        }
      }
    },
    "tex/snow/albedo": {
      bytes: 60446,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "d21e6d8fef0e922499a5229dc1dfe0648466a43e4d20493d311073f3db4dadd8.webp",
      kind: "texture",
      license: "CC0",
      sha256: "d21e6d8fef0e922499a5229dc1dfe0648466a43e4d20493d311073f3db4dadd8",
      source: {
        generated: {
          from: "5a72cfaa616309704a3531ac4018c5dc732a2e4eb4c21a05989c0f5ba2fa93a5",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
          negative: "flowers, blossoms, petals, leaves, branches, twigs, plants, objects, photo, photorealistic, noise, grain, speckles, film grain, text, watermark, logo, perspective, horizon, sky, people, animals, blurry, lowres, 3d render, plastic, miniature, model railway, pattern, wallpaper, decorative, rocks, footprints",
          padding: "circular",
          post: [
            "lanczos 1024",
            "mean shift on 3x3 wrap (spatial 1, colour 1)",
            "stroke noise 80x10 px at three angles, patch-picked (160 px), +-18 sRGB levels (seed 17)",
            "sdxl img2img at 1024",
            "wrapped lanczos to 2048",
            "wrapped bilateral (d 9, colour 10, space 5)",
            "sRGB per-channel mean to the source's, spread 0.9x the source's std",
            "linear per-channel mean scaled to the source's"
          ],
          prompt: "flat seamless ground texture seen from directly above, painted in opaque gouache in the style of Studio Ghibli background art, soft visible brush strokes, uniform coverage, no objects, painted fresh snow, soft white with pale blue shade strokes",
          seed: 3,
          steps: 40,
          strength: 0.55,
          vae: "madebyollin/sdxl-vae-fp16-fix",
          vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd"
        }
      }
    },
    "tex/snow/arm": {
      bytes: 34128,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "873615583c9ea4abe2df7ea717e179883cac9a1703ee0389491523e9946b1abe.webp",
      kind: "texture",
      license: "CC0",
      sha256: "873615583c9ea4abe2df7ea717e179883cac9a1703ee0389491523e9946b1abe",
      source: {
        generated: {
          from: "5a72cfaa616309704a3531ac4018c5dc732a2e4eb4c21a05989c0f5ba2fa93a5",
          from_albedo: "5c5af7592fe8fa34d5944417fd8de46926364c8fe095130ba65c0bea7bebde95",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
          negative: "flowers, blossoms, petals, leaves, branches, twigs, plants, objects, photo, photorealistic, noise, grain, speckles, film grain, text, watermark, logo, perspective, horizon, sky, people, animals, blurry, lowres, 3d render, plastic, miniature, model railway, pattern, wallpaper, decorative, rocks, footprints",
          padding: "circular",
          post: [
            "lanczos 1024",
            "mean shift on 3x3 wrap (spatial 1, colour 1)",
            "stroke noise 80x10 px at three angles, patch-picked (160 px), +-18 sRGB levels (seed 17)",
            "sdxl img2img at 1024",
            "wrapped lanczos to 2048",
            "wrapped bilateral (d 9, colour 10, space 5)",
            "sRGB per-channel mean to the source's, spread 0.9x the source's std",
            "linear per-channel mean scaled to the source's",
            "height as the normal's, at 2048, standardised",
            "R: AO = 1 - 0.12 x cavity (wrapped gaussian 24 px minus height), clamped to [0.82, 1]",
            "G: roughness 0.8 - 0.02 x height, B: metallic 0"
          ],
          prompt: "flat seamless ground texture seen from directly above, painted in opaque gouache in the style of Studio Ghibli background art, soft visible brush strokes, uniform coverage, no objects, painted fresh snow, soft white with pale blue shade strokes",
          seed: 3,
          steps: 40,
          strength: 0.55,
          vae: "madebyollin/sdxl-vae-fp16-fix",
          vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd"
        }
      }
    },
    "tex/snow/normal": {
      bytes: 293428,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 1024
      },
      file: "ae72305005565e9b812900f27382c098d0b2e8f6b7de578740575194176c45be.webp",
      kind: "texture",
      license: "CC0",
      sha256: "ae72305005565e9b812900f27382c098d0b2e8f6b7de578740575194176c45be",
      source: {
        generated: {
          from: "5a72cfaa616309704a3531ac4018c5dc732a2e4eb4c21a05989c0f5ba2fa93a5",
          from_albedo: "5c5af7592fe8fa34d5944417fd8de46926364c8fe095130ba65c0bea7bebde95",
          guidance: 7,
          model: "stabilityai/stable-diffusion-xl-base-1.0",
          model_revision: "462165984030d82259a11f4367a4eed129e94a7b",
          negative: "flowers, blossoms, petals, leaves, branches, twigs, plants, objects, photo, photorealistic, noise, grain, speckles, film grain, text, watermark, logo, perspective, horizon, sky, people, animals, blurry, lowres, 3d render, plastic, miniature, model railway, pattern, wallpaper, decorative, rocks, footprints",
          padding: "circular",
          post: [
            "lanczos 1024",
            "mean shift on 3x3 wrap (spatial 1, colour 1)",
            "stroke noise 80x10 px at three angles, patch-picked (160 px), +-18 sRGB levels (seed 17)",
            "sdxl img2img at 1024",
            "wrapped lanczos to 2048",
            "wrapped bilateral (d 9, colour 10, space 5)",
            "sRGB per-channel mean to the source's, spread 0.9x the source's std",
            "linear per-channel mean scaled to the source's",
            "height: albedo luminance at 1024, wrapped gaussian band-pass (sigma 2 minus 96 px)",
            "OpenGL (+Y) normal by central differences, rms slope 0.06"
          ],
          prompt: "flat seamless ground texture seen from directly above, painted in opaque gouache in the style of Studio Ghibli background art, soft visible brush strokes, uniform coverage, no objects, painted fresh snow, soft white with pale blue shade strokes",
          seed: 3,
          steps: 40,
          strength: 0.55,
          vae: "madebyollin/sdxl-vae-fp16-fix",
          vae_revision: "207b116dae70ace3637169f1ddd2434b91b3a8cd"
        }
      }
    },
    "tex/tulip-field/albedo": {
      bytes: 173978,
      channels: "RGB",
      colorspace: "srgb",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "d403a629743aa2f93b741ffc484e9c450503144584e99f3f8c0e4452653521c3.webp",
      kind: "texture",
      license: "CC0",
      sha256: "d403a629743aa2f93b741ffc484e9c450503144584e99f3f8c0e4452653521c3",
      source: {
        procedural: {
          furrow_m: 1,
          script: "tools/fields/tulip_field.py",
          seed: 5,
          stripe_m: 4,
          stripes: [
            "red",
            "pink",
            "leaf",
            "coral"
          ],
          tile_m: 16
        }
      }
    },
    "tex/tulip-field/arm": {
      bytes: 285018,
      channels: "R=ambient occlusion, G=roughness, B=metallic",
      colorspace: "linear",
      encode: {
        format: "webp",
        method: 6,
        quality: 85,
        size: 2048
      },
      file: "89b693f68dbb30ac5755439d611351f34b66b56c4c56fcbd9b6bbe3b61b0478c.webp",
      kind: "texture",
      license: "CC0",
      sha256: "89b693f68dbb30ac5755439d611351f34b66b56c4c56fcbd9b6bbe3b61b0478c",
      source: {
        procedural: {
          furrow_m: 1,
          script: "tools/fields/tulip_field.py",
          seed: 5,
          stripe_m: 4,
          stripes: [
            "red",
            "pink",
            "leaf",
            "coral"
          ],
          tile_m: 16
        }
      }
    },
    "tex/tulip-field/normal": {
      bytes: 1348476,
      channels: "OpenGL (+Y) tangent-space",
      colorspace: "linear",
      encode: {
        format: "webp",
        lossless: true,
        method: 6,
        size: 1024
      },
      file: "c193c527194c04d2ab1557a5fd717ef4c3f5eddfeea082ce6c11ce620829f80d.webp",
      kind: "texture",
      license: "CC0",
      sha256: "c193c527194c04d2ab1557a5fd717ef4c3f5eddfeea082ce6c11ce620829f80d",
      source: {
        procedural: {
          furrow_m: 1,
          script: "tools/fields/tulip_field.py",
          seed: 5,
          stripe_m: 4,
          stripes: [
            "red",
            "pink",
            "leaf",
            "coral"
          ],
          tile_m: 16
        }
      }
    }
  };

  // plugins/omnishell/interpreter/kinetic.js
  function lerp(a, b, alpha) {
    return a + (b - a) * alpha;
  }
  function lerpAngle(a, b, alpha) {
    let diff = (b - a) % (Math.PI * 2);
    if (diff < -Math.PI) diff += Math.PI * 2;
    if (diff > Math.PI) diff -= Math.PI * 2;
    return a + diff * alpha;
  }
  var TOUCH_ZONE = "data-touch-zone";
  var ZONE_CSS = `[${TOUCH_ZONE}] { touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }`;

  // apps/apexrun/shell/engine/renderer.js
  var STYLE = {
    outline: 0.12,
    saturation: 1
  };
  var GRADE = {
    highlightsHue: 50,
    highlightsDensity: 10,
    highlightsSaturation: 10,
    shadowsHue: 210,
    shadowsDensity: 15,
    shadowsSaturation: 15,
    globalSaturation: 0,
    contrast: 1.08
  };
  var CAMERA_LOOK = 12;
  var SEA_WALL = {
    wall: 3.6,
    out: 4.2,
    height: 0.9
  };
  var PROMENADE = {
    paving: "#8E8B82",
    face: "#9C9E96",
    top: "#B6B3A8"
  };
  var MATERIAL_TINTS = {
    cactus: "#6E8350",
    cactus_tip: "#9AA66E"
  };
  var MATERIAL_LIFT = {
    "cypress/foliage": 1.5,
    "tree-broadleaf-a/foliage": 1.3,
    "tree-broadleaf-b/foliage": 1.3
  };
  var SURFACE_OVERLAYS = {
    "castle-tower/dark": 0.08,
    "castle-tower/wood": 0.08,
    "castle-tower/iron": 0.14,
    "windmill/door": 0.08,
    "windmill/dark": 0.08,
    "lighthouse/door": 0.08,
    "lighthouse/trim": 0.08,
    "hangar/glass": 0.08,
    "colosseum/shade": 0.08,
    "colosseum/shade_deep": 0.08,
    "tower-a/window": 0.06,
    "tower-b/window": 0.06,
    "tower-c/window": 0.06
  };
  function promenadeBed(kind) {
    return kind === "bush" || kind === "flower" ? SEA_WALL.wall - 0.45 : null;
  }
  var WAVE_REST = 1.15;
  var GIRL_ARM = {
    side: 0.08,
    chin: 0.5,
    shoulder: [
      0.15,
      0.39,
      -0.01
    ],
    raise: 1.9,
    out: 0.55,
    swing: 0.3,
    rate: 9
  };
  var GIRL_WAVE_TICKS = 150;
  var GLANCE_PERIOD = 9;
  var GLANCE_SCENERY = 0.6;
  var GLANCE_GIRL = -0.5;
  var LEAD_OUT_METRES = 400;
  var TERMINUS_LAND = 600;
  function runOnMetres(stageId) {
    const destination = STAGE_LOOKS[stageId].destination;
    return destination ? Math.max(...destination.map((piece) => piece.beyond)) + TERMINUS_LAND : LEAD_OUT_METRES;
  }
  var HAZE_IN_METRES = 160;
  var HAZE_OUT_METRES = 240;
  var LEAD_IN_METRES = 400;
  var LEAF_PER_METRE = 1.4;
  var BRUSH_PER_METRE = 0.8;
  var BRUSH_WARM = [
    1.26,
    1.15,
    0.9
  ];
  var BRUSH_COOL = [
    0.72,
    0.82,
    1.02
  ];
  var BRUSH_NEAR = 12;
  var BRUSH_PUSH = 2.8;
  var GRADE_METRES = 2;
  var GRADE_FOOT = [
    0.82,
    0.9,
    1
  ];
  var GRADE_TOP = [
    1.06,
    1.02,
    0.94
  ];
  var CONTOUR = 0.45;
  var LEAF_WARM = [
    1.14,
    1.1,
    0.8
  ];
  var LEAF_COOL = [
    0.72,
    0.86,
    0.86
  ];
  var LEAF_GAP = 0.74;
  var PAINTED_FLOOR = 0.3;
  var PATCH_PER_METRE = 0.045;
  var TOON_DEFS_GLSL = `
#define LEAF_PER_METRE ${LEAF_PER_METRE.toFixed(2)}
#define BRUSH_PER_METRE ${BRUSH_PER_METRE.toFixed(2)}
#define BRUSH_NEAR ${BRUSH_NEAR.toFixed(1)}
#define BRUSH_PUSH ${BRUSH_PUSH.toFixed(2)}
#define LEAF_WARM vec3(${LEAF_WARM.join(", ")})
#define LEAF_COOL vec3(${LEAF_COOL.join(", ")})
#define LEAF_GAP ${LEAF_GAP.toFixed(2)}
#define PAINTED_FLOOR ${PAINTED_FLOOR.toFixed(2)}
#define PATCH_PER_METRE ${PATCH_PER_METRE.toFixed(3)}
#define BRUSH_WARM vec3(${BRUSH_WARM.join(", ")})
#define BRUSH_COOL vec3(${BRUSH_COOL.join(", ")})
#define GRADE_METRES ${GRADE_METRES.toFixed(2)}
#define GRADE_FOOT vec3(${GRADE_FOOT.join(", ")})
#define GRADE_TOP vec3(${GRADE_TOP.join(", ")})
#define CONTOUR ${CONTOUR.toFixed(2)}
#ifdef STK_BRUSH
varying float vStkLift;
uniform sampler2D stkBrush;
float stkBrushPlanes(vec3 q, vec3 w) {
  return texture2D(stkBrush, q.zy).r * w.x + texture2D(stkBrush, q.xz).r * w.y + texture2D(stkBrush, q.xy).r * w.z;
}
vec3 stkBrushTone(vec3 p, vec3 n, float dist) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= dot(w, vec3(1.0));
  float octave = log2(max(dist / BRUSH_NEAR, 1.0));
  float k = BRUSH_PER_METRE / exp2(floor(octave));
  float b = mix(stkBrushPlanes(p * k, w), stkBrushPlanes(p * k * 0.5, w), fract(octave));
  return mix(BRUSH_COOL, BRUSH_WARM, clamp((b - 0.5) * BRUSH_PUSH + 0.5, 0.0, 1.0));
}
#endif
float stkHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float stkNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(stkHash(i), stkHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(stkHash(i + vec3(0.0, 1.0, 0.0)), stkHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(stkHash(i + vec3(0.0, 0.0, 1.0)), stkHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(stkHash(i + vec3(0.0, 1.0, 1.0)), stkHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float stkGrain(vec3 p) { return 0.65 * stkNoise(p) + 0.35 * stkNoise(p * 2.7); }
#ifdef STK_LEAVES
float stkCells(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); float d = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 r = o + vec3(stkHash(i + o), stkHash(i + o + 17.1), stkHash(i + o + 31.7)) - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
#endif
`;
  var TOON_DEFS_WGSL = `
const LEAF_PER_METRE: f32 = ${LEAF_PER_METRE.toFixed(2)};
const BRUSH_PER_METRE: f32 = ${BRUSH_PER_METRE.toFixed(2)};
const BRUSH_NEAR: f32 = ${BRUSH_NEAR.toFixed(1)};
const BRUSH_PUSH: f32 = ${BRUSH_PUSH.toFixed(2)};
const LEAF_WARM: vec3f = vec3f(${LEAF_WARM.join(", ")});
const LEAF_COOL: vec3f = vec3f(${LEAF_COOL.join(", ")});
const LEAF_GAP: f32 = ${LEAF_GAP.toFixed(2)};
const PAINTED_FLOOR: f32 = ${PAINTED_FLOOR.toFixed(2)};
const PATCH_PER_METRE: f32 = ${PATCH_PER_METRE.toFixed(3)};
const BRUSH_WARM: vec3f = vec3f(${BRUSH_WARM.join(", ")});
const BRUSH_COOL: vec3f = vec3f(${BRUSH_COOL.join(", ")});
const GRADE_METRES: f32 = ${GRADE_METRES.toFixed(2)};
const GRADE_FOOT: vec3f = vec3f(${GRADE_FOOT.join(", ")});
const GRADE_TOP: vec3f = vec3f(${GRADE_TOP.join(", ")});
const CONTOUR: f32 = ${CONTOUR.toFixed(2)};
#ifdef STK_BRUSH
varying vStkLift: f32;
var stkBrushSampler: sampler;
var stkBrush: texture_2d<f32>;
fn stkBrushPlanes(q: vec3f, w: vec3f) -> f32 {
  return textureSample(stkBrush, stkBrushSampler, q.zy).r * w.x + textureSample(stkBrush, stkBrushSampler, q.xz).r * w.y + textureSample(stkBrush, stkBrushSampler, q.xy).r * w.z;
}
fn stkBrushTone(p: vec3f, n: vec3f, dist: f32) -> vec3f {
  var w = pow(abs(n), vec3f(4.0));
  w /= dot(w, vec3f(1.0));
  let octave = log2(max(dist / BRUSH_NEAR, 1.0));
  let k = BRUSH_PER_METRE / exp2(floor(octave));
  let b = mix(stkBrushPlanes(p * k, w), stkBrushPlanes(p * k * 0.5, w), fract(octave));
  return mix(BRUSH_COOL, BRUSH_WARM, clamp((b - 0.5) * BRUSH_PUSH + 0.5, 0.0, 1.0));
}
#endif
fn stkHash(q: vec3f) -> f32 { var p = fract(q * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
fn stkNoise(p: vec3f) -> f32 {
  let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(stkHash(i), stkHash(i + vec3f(1.0, 0.0, 0.0)), f.x), mix(stkHash(i + vec3f(0.0, 1.0, 0.0)), stkHash(i + vec3f(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(stkHash(i + vec3f(0.0, 0.0, 1.0)), stkHash(i + vec3f(1.0, 0.0, 1.0)), f.x), mix(stkHash(i + vec3f(0.0, 1.0, 1.0)), stkHash(i + vec3f(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
fn stkGrain(p: vec3f) -> f32 { return 0.65 * stkNoise(p) + 0.35 * stkNoise(p * 2.7); }
#ifdef STK_LEAVES
fn stkCells(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 8.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec3f(f32(x), f32(y), f32(z));
    let r = o + vec3f(stkHash(i + o), stkHash(i + o + 17.1), stkHash(i + o + 31.7)) - f;
    d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
#endif
`;
  function brushed(name) {
    return name !== "bGroundMat" && name !== "bRoadMat";
  }
  function toonable(name) {
    return !/^(kart_.+|bTraffic_\w+)_(paint|chrome|rim|glass)$/.test(name);
  }
  function grainOf(name) {
    if (name === "bGroundMat") return "patch";
    if ([
      "foliage",
      "frond"
    ].includes(name.split("#").pop())) return "leaves";
    return null;
  }
  var CLOUD_KINDS = {
    tower: 1,
    bank: 2.6,
    twin: 1.7,
    puff: 1.35,
    anvil: 1.5,
    ridge: 2.2,
    spire: 0.75
  };
  function cloudLook(stageId, k) {
    const stageSeed = [
      ...stageId
    ].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 8;
    const kinds = Object.keys(CLOUD_KINDS);
    const seed = stageSeed + k;
    const kind = kinds[seed % kinds.length];
    return {
      seed,
      kind,
      size: [
        Math.round(160 * CLOUD_KINDS[kind]),
        160
      ],
      key: `cumulus_${seed}`
    };
  }
  var CLOUD_BANKS = [
    {
      distance: 1300,
      span: 6e3,
      lift: 140,
      metres: [
        380,
        520
      ],
      haze: 0,
      cards: 4
    },
    {
      distance: 2200,
      span: 8e3,
      lift: 220,
      metres: [
        520,
        720
      ],
      haze: 0.15,
      cards: 5
    },
    {
      distance: 3400,
      span: 1e4,
      lift: 340,
      metres: [
        700,
        950
      ],
      haze: 0.3,
      cards: 5
    }
  ];
  var LANDMARKS = /* @__PURE__ */ new Set([
    "colosseum",
    "lighthouse",
    "castleTower",
    "windmill",
    "hangar",
    "mesa",
    "cliff",
    "brokenArch",
    "tower"
  ]);
  var LANDMARK_SPACING = 900;
  var LANDMARK_START = 400;
  var HERO_TURN = 0.47;
  var HERO_AIM = 0.45;
  var PULL_BACK = 7.8;
  var PULL_UP = 3.9;
  var PULL_SWING = 2.7;
  var PULL_LENS = 0.094;
  var CHASE_BACK = 7.5;
  var CHASE_UP = 3;
  var CHASE_AIM = 18;
  var NEAR_FULL = 8;
  var NEAR_GONE = 90;
  var HOOD_IN = 8e-3;
  var HOOD_OUT = 4e-3;
  var CREST_LIFT = 7;
  function landmarkPull(ahead) {
    return (1 - smoothstep(460, 620, ahead)) * smoothstep(-60, 80, ahead);
  }
  function stageHaze(state, metres) {
    const end = state.trackLength * METRES_PER_UNIT;
    const fork = !!OUTRUN_STAGES[state.stageId]?.fork;
    const coming = fork && (state.stageState === "racing" || state.stageState === "checkpoint") ? smoothstep(end - HAZE_IN_METRES, end, metres) : 0;
    const leaving = state.stageNum > 1 ? 1 - smoothstep(0, HAZE_OUT_METRES, metres) : 0;
    return Math.max(coming, leaving);
  }
  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  var MARSHAL_WAVE = 0.35;
  var MARSHAL_LIFT_TICKS = 40;
  var MARSHAL_WAVE_IN = 20;
  var MARSHAL_FLAG_DRAG = 2.5;
  function easeInOutBack(t) {
    const c = 1.2;
    const u = Math.max(0, Math.min(1, t)) * 2;
    return u < 1 ? u * u * ((c + 1) * u - c) / 2 : ((u - 2) * (u - 2) * ((c + 1) * (u - 2) + c) + 2) / 2;
  }
  function marshalArm({ stageState, countdown, goTimer, tick }) {
    const counting = stageState === "warmup" && countdown <= COUNTDOWN_TICKS;
    let raise = 0;
    if (counting) raise = 1;
    else if (stageState === "warmup") raise = easeInOutBack((INTRO_TICKS + COUNTDOWN_TICKS - countdown) / MARSHAL_LIFT_TICKS);
    else if (goTimer > 0) raise = 1 - easeInOutBack(1 - goTimer / GO_TICKS);
    const wave = counting ? MARSHAL_WAVE * smoothstep(0, MARSHAL_WAVE_IN, COUNTDOWN_TICKS - countdown) * Math.sin(tick * 0.3) : 0;
    return -Math.PI * raise + wave;
  }
  function marshalPose(state) {
    const arm = marshalArm(state);
    const before = marshalArm({
      stageState: state.stageState,
      countdown: state.countdown + 1,
      goTimer: state.goTimer > 0 ? Math.min(GO_TICKS, state.goTimer + 1) : 0,
      tick: state.tick - 1
    });
    return {
      arm,
      flag: -MARSHAL_FLAG_DRAG * (arm - before)
    };
  }
  function sampleRoadPoint(centerline, z, x) {
    const { pts, rights, headings, segLen, rumbleW, forkDiverge, endOn } = centerline;
    const laneShift = (segIdx) => {
      const shift = (forkDiverge[segIdx] || 0) * rights[segIdx].x;
      return x < 0 ? -shift : shift;
    };
    const end = pts[pts.length - 1];
    if (z > end.z) {
      const k = pts.length - 1;
      const prev = pts[Math.max(0, k - 1)];
      const endRun = Math.hypot(end.x - prev.x, end.z - prev.z) || 1;
      const onX = endOn ? endOn.x : (end.x - prev.x) / endRun;
      const onZ = endOn ? endOn.z : (end.z - prev.z) / endRun;
      const along = (z - end.z) / (onZ || 1);
      return {
        x: end.x + onX * along + laneShift(k) + x * rumbleW,
        y: end.y,
        z,
        yaw: headings[k]
      };
    }
    const last = pts.length - 1.000001;
    const f = Math.max(0, Math.min(last, z / segLen));
    const i = Math.floor(f);
    const t = f - i;
    const a = pts[i];
    const b = pts[i + 1];
    const X = lerp(a.x + laneShift(i), b.x + laneShift(i + 1), t) + x * rumbleW;
    let g = f;
    for (let k = 0; k < 2; k++) {
      const j2 = Math.floor(g);
      const u = g - j2;
      const rx = lerp(rights[j2].x, rights[j2 + 1].x, u);
      const rz = lerp(rights[j2].z, rights[j2 + 1].z, u);
      const d = (X - lerp(pts[j2].x, pts[j2 + 1].x, u)) * rx + (z - lerp(pts[j2].z, pts[j2 + 1].z, u)) * rz;
      g = Math.max(0, Math.min(last, (z - rz * d) / segLen));
    }
    const j = Math.floor(g);
    return {
      x: X,
      y: lerp(pts[j].y, pts[j + 1].y, g - j),
      z,
      yaw: lerpAngle(headings[i], headings[i + 1], t)
    };
  }
  function sampleRoadPose(centerline, z, x, axleFront = 1.38, axleRear = 1.38) {
    const road = sampleRoadPoint(centerline, z, x);
    const front = sampleRoadPoint(centerline, z + axleFront, x).y;
    const rear = sampleRoadPoint(centerline, z - axleRear, x).y;
    const grade = (front - rear) / (axleFront + axleRear);
    return {
      ...road,
      y: rear + grade * axleRear,
      pitch: Math.atan(grade)
    };
  }
  function buildStageLandmarks(ahead, destination, spot, pts, forkStart) {
    const mark = (pl) => {
      const at = spot(pl);
      return {
        z: at.z,
        side: pl.side,
        x: at.x,
        y: at.y,
        height: (KIND_HEIGHT[pl.kind] ?? 0) * pl.scale,
        hero: !!pl.landmark
      };
    };
    const heroes = ahead.filter((pl) => pl.landmark).map(mark);
    if (destination.length) {
      const [place] = destination;
      heroes.push({
        z: place.z,
        side: 0,
        x: place.x,
        y: place.y,
        height: KIND_HEIGHT[place.kind] * place.scale,
        hero: true
      });
    }
    if (forkStart < pts.length) heroes.push({
      z: pts[forkStart].z,
      side: 0,
      hero: false
    });
    const z0 = pts[0].z + LANDMARK_START;
    const landmarks = heroes.filter((m) => m.z >= z0);
    for (const m of ahead.filter((pl) => LANDMARKS.has(pl.kind) && !pl.landmark).map(mark).sort((a, b) => a.z - b.z)) {
      if (m.z >= z0 && landmarks.every((o) => Math.abs(m.z - o.z) >= LANDMARK_SPACING)) landmarks.push(m);
    }
    landmarks.sort((a, b) => a.z - b.z);
    return landmarks;
  }
  function computeRiderPose(state, kart, windTime, index = 0) {
    const u = 1 - (kart.waveTimer ?? 0) / WAVE_TICKS;
    const lift = kart.waveTimer > 0 ? smoothstep(0, 0.2, u) * (1 - smoothstep(0.8, 1, u)) : 0;
    const waveZ = lerp(WAVE_REST, Math.sin(windTime * 13) * 0.3, lift);
    const t = windTime + index * 3.7;
    const glance = smoothstep(0, 1.2, t % GLANCE_PERIOD) * (1 - smoothstep(2.6, 3.8, t % GLANCE_PERIOD));
    const headY = (Math.floor(t / GLANCE_PERIOD) % 2 ? GLANCE_GIRL : GLANCE_SCENERY) * glance;
    const parked = kart.isPlayer && state.parkedAt != null ? state.endTicks - state.parkedAt : -1;
    const greet = parked < 0 ? 0 : smoothstep(0, 20, parked) * (1 - smoothstep(GIRL_WAVE_TICKS - 20, GIRL_WAVE_TICKS, parked));
    return {
      waveZ,
      waving: (kart.waveTimer ?? 0) > 0,
      headY,
      greet,
      girlRaise: GIRL_ARM.raise * greet,
      girlOut: greet * GIRL_ARM.out,
      girlSwing: greet * GIRL_ARM.swing * Math.sin(windTime * GIRL_ARM.rate)
    };
  }
  function computeCameraPose(state, player, heroPose, roadAt, landmarks, camState, aspect, cut = null) {
    const px = heroPose.x;
    const py = heroPose.y;
    const pz = heroPose.z;
    const playerLx = player.x || 0;
    const playerSwing = player.heading || 0;
    const playerPitch = heroPose.pitch || 0;
    const ahead = roadAt(pz + 18, playerLx);
    const pace = Math.min(1, Math.max(0, (player.speed || 0) / 315));
    let near = 0;
    for (const other of [
      ...state.traffic || [],
      ...(state.karts || []).filter((k) => !k.isPlayer)
    ]) {
      const d = Math.hypot((other.z - player.z) * METRES_PER_UNIT, (other.x - player.x) * LATERAL_UNITS);
      near = Math.max(near, 1 - smoothstep(NEAR_FULL, NEAR_GONE, d));
    }
    let pull = 0;
    let pullSide = 0;
    let hero = null;
    for (const m of landmarks) {
      const w = landmarkPull(m.z - pz);
      if (w > pull) {
        pull = w;
        pullSide = m.side;
        hero = m.hero ? m : null;
      }
    }
    const gradeAhead = (roadAt(pz + 40, playerLx).y - roadAt(pz + 30, playerLx).y) / 10;
    const crest = Math.min(0.3, Math.max(0, playerPitch - Math.atan(gradeAhead)));
    const lag = CHASE_BACK + 2 * pace + 4 * camState.boostT + PULL_BACK * pull;
    const back = roadAt(pz - lag, playerLx);
    const cos = Math.cos(playerPitch);
    const sin = Math.sin(playerPitch);
    const intro = state.stageState === "warmup" ? Math.max(0, Math.min(1, (state.countdown - COUNTDOWN_TICKS) / INTRO_TICKS)) : 0;
    const e = intro * intro * (3 - 2 * intro);
    const hoodTarget = near * (1 - camState.boostT) * (1 - e);
    camState.hoodT += (hoodTarget - camState.hoodT) * (hoodTarget > camState.hoodT ? HOOD_IN : HOOD_OUT);
    if (cut) camState.hoodT = 0;
    const hood = camState.hoodT;
    const rise = CREST_LIFT * crest;
    const up = CHASE_UP - 0.15 * pace - 0.5 * camState.boostT + rise + PULL_UP * pull;
    const trail = pullSide * PULL_SWING * pull;
    const look = playerSwing * CAMERA_LOOK;
    const aim = CHASE_AIM + 4 * camState.boostT + 4 * pull;
    const aimUp = 0.3 + 0.6 * camState.boostT;
    const chaseEyeX = back.x - trail - 14 * e;
    const chaseEyeY = py - lag * sin + up * cos + 30 * e;
    const chaseEyeZ = pz - lag * cos - up * sin - 18 * e;
    let chaseAtX = ahead.x - trail * 0.5 + look + pullSide * 4.7 * pull;
    let chaseAtY = py + aim * sin + aimUp * cos - 0.6 * rise - 6 * e;
    let chaseAtZ = pz + aim * cos - aimUp * sin - 8 * e;
    if (hero) {
      const rx = chaseAtX - chaseEyeX;
      const ry = chaseAtY - chaseEyeY;
      const rz = chaseAtZ - chaseEyeZ;
      const reach = Math.hypot(rx, ry, rz) || 1;
      const rnx = rx / reach;
      const rny = ry / reach;
      const rnz = rz / reach;
      const hx = hero.x - chaseEyeX;
      const hy = hero.y + hero.height * HERO_AIM - chaseEyeY;
      const hz = hero.z - chaseEyeZ;
      const hLen = Math.hypot(hx, hy, hz) || 1;
      const hnx = hx / hLen;
      const hny = hy / hLen;
      const hnz = hz / hLen;
      const turn = HERO_TURN * pull;
      const tx = lerp(rnx, hnx, turn);
      const ty = lerp(rny, hny, turn);
      const tz = lerp(rnz, hnz, turn);
      const tLen = Math.hypot(tx, ty, tz) || 1;
      chaseAtX = chaseEyeX + tx / tLen * reach;
      chaseAtY = chaseEyeY + ty / tLen * reach;
      chaseAtZ = chaseEyeZ + tz / tLen * reach;
    }
    const vibe = Math.sin((state.tick || 0) * 0.8) * ((player.speed || 0) / 300) * 6e-3;
    const hoodUp = HOOD_EYE.up + vibe;
    const hoodEyeX = px;
    const hoodEyeY = py + hoodUp * cos + HOOD_EYE.ahead * sin;
    const hoodEyeZ = pz + HOOD_EYE.ahead * cos - hoodUp * sin;
    const hoodAtX = ahead.x + look;
    const hoodAtZ = pz + 24;
    const hoodAtY = hoodEyeY - 0.05 + Math.tan(playerPitch) * (hoodAtZ - hoodEyeZ);
    camState.lens = lerp(camState.lens, lerp(speedFov(player.speed || 0, camState.boostT) + PULL_LENS * pull, 0.92 + 0.1 * camState.boostT, hood), 0.1);
    const fov = coverFov(camState.lens, aspect);
    return {
      eye: [
        lerp(chaseEyeX, hoodEyeX, hood),
        lerp(chaseEyeY, hoodEyeY, hood),
        lerp(chaseEyeZ, hoodEyeZ, hood)
      ],
      at: [
        lerp(chaseAtX, hoodAtX, hood),
        lerp(chaseAtY, hoodAtY, hood),
        lerp(chaseAtZ, hoodAtZ, hood)
      ],
      fov
    };
  }
  var HOOD_EYE = {
    up: 1,
    ahead: 1
  };
  var GLOW_NITRO = Object.freeze({
    r: 1,
    g: 0.55,
    b: 0.1
  });
  function speedFov(speed, boost) {
    return 0.68 + 0.12 * Math.min(1, Math.max(0, speed) / 320) ** 1.3 + 0.11 * boost;
  }
  function coverFov(lens, aspect) {
    const wide = 16 / 9;
    return aspect >= wide ? lens : 2 * Math.atan(Math.tan(lens / 2) * wide / aspect);
  }

  // plugins/omnishell/interpreter/gltf.js
  var GLB_MAGIC = 1179937895;
  var GLB_VERSION = 2;
  var CHUNK_JSON = 1313821514;
  var CHUNK_BIN = 5130562;
  var COMPONENT_FLOAT = 5126;
  var COMPONENT_UNSIGNED_INT = 5125;
  function yawToQuat(yaw, pitch = 0, roll = 0) {
    const cy = Math.cos(yaw * 0.5);
    const sy = Math.sin(yaw * 0.5);
    const cp = Math.cos(pitch * 0.5);
    const sp = Math.sin(pitch * 0.5);
    const cr = Math.cos(roll * 0.5);
    const sr = Math.sin(roll * 0.5);
    return [
      cy * sp * cr + sy * cp * sr,
      sy * cp * cr - cy * sp * sr,
      cy * cp * sr - sy * sp * cr,
      cy * cp * cr + sy * sp * sr
    ];
  }
  function hexToRgba(hex) {
    const clean = hex.replace(/^#/, "");
    const n = parseInt(clean, 16);
    return [
      (n >> 16 & 255) / 255,
      (n >> 8 & 255) / 255,
      (n & 255) / 255,
      1
    ];
  }
  var BinaryCollector = class {
    constructor() {
      this.parts = [];
      this.byteLength = 0;
      this.bufferViews = [];
      this.accessors = [];
    }
    _pad4() {
      const rem = this.byteLength % 4;
      if (rem !== 0) {
        const pad = new Uint8Array(4 - rem);
        this.parts.push(pad);
        this.byteLength += pad.byteLength;
      }
    }
    addBytes(bytes, target) {
      this._pad4();
      const byteOffset = this.byteLength;
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const copy = new Uint8Array(u8.byteLength);
      copy.set(u8);
      this.parts.push(copy);
      this.byteLength += copy.byteLength;
      const viewIndex = this.bufferViews.length;
      const view = {
        buffer: 0,
        byteOffset,
        byteLength: copy.byteLength,
        ...target ? {
          target
        } : {}
      };
      this.bufferViews.push(view);
      return viewIndex;
    }
    addFloatAccessor(floats, type, count) {
      const f32 = floats instanceof Float32Array ? floats : new Float32Array(floats);
      const viewIndex = this.addBytes(f32);
      const components = type === "SCALAR" ? 1 : type === "VEC2" ? 2 : type === "VEC3" ? 3 : 4;
      const min = new Array(components).fill(Infinity);
      const max = new Array(components).fill(-Infinity);
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < components; c++) {
          const v = f32[i * components + c];
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
      }
      const accIndex = this.accessors.length;
      this.accessors.push({
        bufferView: viewIndex,
        byteOffset: 0,
        componentType: COMPONENT_FLOAT,
        count,
        type,
        ...count > 0 ? {
          min,
          max
        } : {}
      });
      return accIndex;
    }
    addIndexAccessor(indices) {
      const u32 = indices instanceof Uint32Array ? indices : new Uint32Array(indices);
      const viewIndex = this.addBytes(u32);
      const accIndex = this.accessors.length;
      this.accessors.push({
        bufferView: viewIndex,
        byteOffset: 0,
        componentType: COMPONENT_UNSIGNED_INT,
        count: u32.length,
        type: "SCALAR"
      });
      return accIndex;
    }
    finish() {
      this._pad4();
      const out = new Uint8Array(this.byteLength);
      let offset = 0;
      for (const p of this.parts) {
        out.set(p, offset);
        offset += p.byteLength;
      }
      return out;
    }
  };
  function buildRibbonPrimitive(bin, pathA, pathB, materialIndex, uvScaleZ = 0.1) {
    const n = Math.min(pathA.length, pathB.length);
    const positions = new Float32Array(n * 2 * 3);
    const normals = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    const indices = new Uint32Array(Math.max(0, n - 1) * 6);
    for (let i = 0; i < n; i++) {
      const a = pathA[i];
      const b = pathB[i];
      const baseV = i * 2;
      positions[baseV * 3 + 0] = a.x;
      positions[baseV * 3 + 1] = a.y;
      positions[baseV * 3 + 2] = a.z;
      positions[(baseV + 1) * 3 + 0] = b.x;
      positions[(baseV + 1) * 3 + 1] = b.y;
      positions[(baseV + 1) * 3 + 2] = b.z;
      normals[baseV * 3 + 1] = 1;
      normals[(baseV + 1) * 3 + 1] = 1;
      const vCoord = a.z * uvScaleZ;
      uvs[baseV * 2 + 0] = 0;
      uvs[baseV * 2 + 1] = vCoord;
      uvs[(baseV + 1) * 2 + 0] = 1;
      uvs[(baseV + 1) * 2 + 1] = vCoord;
    }
    let idx = 0;
    for (let i = 0; i < n - 1; i++) {
      const v0 = i * 2;
      const v1 = v0 + 1;
      const v2 = v0 + 2;
      const v3 = v0 + 3;
      indices[idx++] = v0;
      indices[idx++] = v2;
      indices[idx++] = v1;
      indices[idx++] = v1;
      indices[idx++] = v2;
      indices[idx++] = v3;
    }
    const posAcc = bin.addFloatAccessor(positions, "VEC3", n * 2);
    const normAcc = bin.addFloatAccessor(normals, "VEC3", n * 2);
    const uvAcc = bin.addFloatAccessor(uvs, "VEC2", n * 2);
    const indAcc = bin.addIndexAccessor(indices);
    return {
      attributes: {
        POSITION: posAcc,
        NORMAL: normAcc,
        TEXCOORD_0: uvAcc
      },
      indices: indAcc,
      material: materialIndex,
      mode: 4
    };
  }
  function encodeUtf8(str) {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(str);
    }
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c >= 55296 && c <= 56319 && i + 1 < str.length) {
        const low = str.charCodeAt(i + 1);
        if (low >= 56320 && low <= 57343) {
          c = (c - 55296 << 10) + (low - 56320) + 65536;
          i++;
        }
      }
      if (c < 128) {
        bytes.push(c);
      } else if (c < 2048) {
        bytes.push(192 | c >> 6, 128 | c & 63);
      } else if (c < 65536) {
        bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
      } else {
        bytes.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
      }
    }
    return new Uint8Array(bytes);
  }
  function packGlb(gltfJson, binBytes = new Uint8Array(0)) {
    const jsonBytes = encodeUtf8(JSON.stringify(gltfJson));
    const jsonPad = (4 - jsonBytes.byteLength % 4) % 4;
    const jsonChunkLen = jsonBytes.byteLength + jsonPad;
    const binPad = (4 - binBytes.byteLength % 4) % 4;
    const binChunkLen = binBytes.byteLength + binPad;
    const totalLen = 12 + 8 + jsonChunkLen + (binChunkLen > 0 ? 8 + binChunkLen : 0);
    const out = new Uint8Array(totalLen);
    const view = new DataView(out.buffer);
    view.setUint32(0, GLB_MAGIC, true);
    view.setUint32(4, GLB_VERSION, true);
    view.setUint32(8, totalLen, true);
    view.setUint32(12, jsonChunkLen, true);
    view.setUint32(16, CHUNK_JSON, true);
    out.set(jsonBytes, 20);
    for (let i = 0; i < jsonPad; i++) {
      out[20 + jsonBytes.byteLength + i] = 32;
    }
    if (binChunkLen > 0) {
      const binHeaderOffset = 20 + jsonChunkLen;
      view.setUint32(binHeaderOffset, binChunkLen, true);
      view.setUint32(binHeaderOffset + 4, CHUNK_BIN, true);
      out.set(binBytes, binHeaderOffset + 8);
    }
    return out;
  }

  // apps/apexrun/shell/engine/stage_gltf.js
  var SCATTER_CHUNK = 25;
  var SCATTER_BEHIND = 30;
  var SCATTER_AHEAD = 360;
  var SWAYING = /* @__PURE__ */ new Set([
    "frond",
    "frond_dry",
    "grass",
    "leaf"
  ]);
  function getCurve(stage, segIdx) {
    for (const c of stage.curves) {
      if (segIdx >= c.start && segIdx < c.start + c.length) return c.curve;
    }
    return 0;
  }
  function getPitch(stage, segIdx) {
    for (const c of stage.curves) {
      if (segIdx >= c.start && segIdx < c.start + c.length) return c.pitch;
    }
    return 0;
  }
  function buildStageCenterline(stageId) {
    const stage = OUTRUN_STAGES[stageId];
    if (!stage) throw new Error(`stage_gltf: unknown stage ${stageId}`);
    const segLen = stage.segmentLength * METRES_PER_UNIT;
    const rumbleW = LATERAL_UNITS;
    const halfW = rumbleW * 0.94;
    const pts = [];
    let x = 0;
    let dx = 0;
    let y = 0;
    let dy = 0;
    for (let i = 0; i < stage.segmentCount; i++) {
      const z = i * segLen;
      const c = getCurve(stage, i);
      dx += (c * segLen / 10 - dx) * 0.08;
      x += dx;
      const p = getPitch(stage, i);
      dy += (p * segLen / 75 - dy) * 0.08;
      y += dy;
      pts.push({
        x,
        y,
        z
      });
    }
    const rights = pts.map((_, i) => {
      const a = pts[Math.max(0, i - 1)];
      const c = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(c.x - a.x, c.z - a.z) || 1;
      return {
        x: (c.z - a.z) / len,
        y: 0,
        z: -(c.x - a.x) / len
      };
    });
    const headings = rights.map((r) => Math.atan2(-r.z, r.x));
    const forkStart = stage.fork ? stage.fork.forkSegment : pts.length;
    const forkLength = Math.max(1, pts.length - forkStart - 1);
    const forkDiverge = pts.map((_, i) => i < forkStart ? 0 : ((i - forkStart) / forkLength) ** 2 * halfW * 2);
    const run = Math.hypot(pts[1].x - pts[0].x, pts[1].z - pts[0].z) || 1;
    const back = {
      x: (pts[0].x - pts[1].x) / run,
      z: (pts[0].z - pts[1].z) / run
    };
    const leadSegs = Math.ceil(LEAD_IN_METRES / segLen);
    const leadPts = [];
    for (let k = leadSegs; k > 0; k--) {
      leadPts.push({
        x: pts[0].x + back.x * k * segLen,
        y: pts[0].y,
        z: pts[0].z + back.z * k * segLen
      });
    }
    leadPts.push(pts[0]);
    const leadRights = leadPts.map(() => rights[0]);
    const last = pts.length - 1;
    const endRun = Math.hypot(pts[last].x - pts[last - 1].x, pts[last].z - pts[last - 1].z) || 1;
    const endOn = {
      x: (pts[last].x - pts[last - 1].x) / endRun,
      z: (pts[last].z - pts[last - 1].z) / endRun
    };
    const leadOutPts = [
      pts[last]
    ];
    const outSegs = Math.ceil(runOnMetres(stageId) / segLen);
    for (let k = 1; k <= outSegs; k++) {
      leadOutPts.push({
        x: pts[last].x + endOn.x * k * segLen,
        y: pts[last].y,
        z: pts[last].z + endOn.z * k * segLen
      });
    }
    const leadOutRights = leadOutPts.map(() => rights[last]);
    const look = STAGE_LOOKS[stageId];
    const ahead = placeProps(stageId, pts.length, forkStart);
    const destination = look?.destination ? look.destination.map((piece) => ({
      ...piece,
      x: pts[last].x + endOn.x * piece.beyond + rights[last].x * piece.across,
      y: pts[last].y - 0.05,
      z: pts[last].z + endOn.z * piece.beyond + rights[last].z * piece.across,
      yaw: Math.atan2(-endOn.x, -endOn.z)
    })) : [];
    const spot = (pl) => {
      const i = Math.max(0, Math.min(pts.length - 1, pl.i));
      const p = pts[i];
      const r = rights[i];
      const d = pl.side === 0 ? 0 : rumbleW + (forkDiverge[i] || 0) + pl.offset;
      return {
        x: p.x + r.x * pl.side * d,
        y: p.y + (pl.yOffset || 0),
        z: p.z + r.z * pl.side * d
      };
    };
    const landmarks = buildStageLandmarks(ahead, destination, spot, pts, forkStart);
    return {
      stage,
      segLen,
      rumbleW,
      halfW,
      pts,
      rights,
      headings,
      forkStart,
      forkDiverge,
      endOn,
      landmarks,
      leadPts,
      leadRights,
      leadOutPts,
      leadOutRights
    };
  }
  function materialStkExtras(name, options = {}) {
    const shortKey = name.includes("#") ? name.split("#").pop() : name;
    const modelMatKey = options.modelKey ? `${options.modelKey}/${shortKey}` : name;
    const toon = toonable(name);
    const isPainted = options.painted === true;
    const isBrushed = toon && !isPainted && brushed(name);
    const isSway = SWAYING.has(shortKey);
    const depthOffset = SURFACE_OVERLAYS[modelMatKey] ?? SURFACE_OVERLAYS[name] ?? 0;
    const tint = MATERIAL_TINTS[shortKey] ?? MATERIAL_TINTS[name] ?? null;
    const lift = MATERIAL_LIFT[modelMatKey] ?? MATERIAL_LIFT[name] ?? 1;
    const grain = grainOf(name);
    return {
      toon,
      painted: isPainted,
      brushed: isBrushed,
      sway: isSway,
      depthOffset,
      tint,
      lift,
      grain,
      ...options.cloud || name === "bCloudMat" ? {
        cloud: true
      } : {}
    };
  }
  function buildMultiBandRibbonPrimitive(bin, paths, materialIndex, uvScale = 0.05) {
    const m = paths.length;
    const n = paths[0]?.length ?? 0;
    const totalV = m * n;
    const positions = new Float32Array(totalV * 3);
    const normals = new Float32Array(totalV * 3);
    const uvs = new Float32Array(totalV * 2);
    const indices = new Uint32Array(Math.max(0, m - 1) * Math.max(0, n - 1) * 6);
    for (let b = 0; b < m; b++) {
      const path = paths[b];
      const pathPrev = paths[Math.max(0, b - 1)];
      const pathNext = paths[Math.min(m - 1, b + 1)];
      for (let i = 0; i < n; i++) {
        const p = path[i];
        const pPrevB = pathPrev[i];
        const pNextB = pathNext[i];
        const pPrevI = path[Math.max(0, i - 1)];
        const pNextI = path[Math.min(n - 1, i + 1)];
        const ux = pNextB.x - pPrevB.x;
        const uy = pNextB.y - pPrevB.y;
        const uz = pNextB.z - pPrevB.z;
        const vx = pNextI.x - pPrevI.x;
        const vy = pNextI.y - pPrevI.y;
        const vz = pNextI.z - pPrevI.z;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        if (ny < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const nLen = Math.hypot(nx, ny, nz) || 1;
        const v = b * n + i;
        positions[v * 3 + 0] = p.x;
        positions[v * 3 + 1] = p.y;
        positions[v * 3 + 2] = p.z;
        normals[v * 3 + 0] = nx / nLen;
        normals[v * 3 + 1] = ny / nLen;
        normals[v * 3 + 2] = nz / nLen;
        uvs[v * 2 + 0] = p.x * uvScale;
        uvs[v * 2 + 1] = p.z * uvScale;
      }
    }
    let idx = 0;
    for (let b = 0; b < m - 1; b++) {
      for (let i = 0; i < n - 1; i++) {
        const v0 = b * n + i;
        const v1 = (b + 1) * n + i;
        const v2 = b * n + (i + 1);
        const v3 = (b + 1) * n + (i + 1);
        indices[idx++] = v0;
        indices[idx++] = v2;
        indices[idx++] = v1;
        indices[idx++] = v1;
        indices[idx++] = v2;
        indices[idx++] = v3;
      }
    }
    return {
      attributes: {
        POSITION: bin.addFloatAccessor(positions, "VEC3", totalV),
        NORMAL: bin.addFloatAccessor(normals, "VEC3", totalV),
        TEXCOORD_0: bin.addFloatAccessor(uvs, "VEC2", totalV)
      },
      indices: bin.addIndexAccessor(indices),
      material: materialIndex
    };
  }
  function buildUnitProxyPrimitive(bin, materialIndex) {
    const positions = new Float32Array([
      -0.5,
      0,
      -0.5,
      0.5,
      0,
      -0.5,
      0.5,
      1,
      -0.5,
      -0.5,
      1,
      -0.5,
      -0.5,
      0,
      0.5,
      0.5,
      0,
      0.5,
      0.5,
      1,
      0.5,
      -0.5,
      1,
      0.5
    ]);
    const normals = new Float32Array([
      0,
      1,
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      0,
      1,
      0
    ]);
    const indices = new Uint32Array([
      0,
      1,
      2,
      0,
      2,
      3,
      4,
      6,
      5,
      4,
      7,
      6
    ]);
    return {
      attributes: {
        POSITION: bin.addFloatAccessor(positions, "VEC3", 8),
        NORMAL: bin.addFloatAccessor(normals, "VEC3", 8)
      },
      indices: bin.addIndexAccessor(indices),
      material: materialIndex
    };
  }
  function buildStageGltf(stageId, options = {}) {
    const { stage, segLen, rumbleW, halfW, pts, rights, headings, forkStart, forkDiverge, leadPts, leadRights, leadOutPts, leadOutRights } = buildStageCenterline(stageId);
    const art = STAGE_ART[stageId];
    const look = STAGE_LOOKS[stageId];
    const shoreSide = look?.water?.side === "left" ? -1 : look?.water?.side === "right" ? 1 : 0;
    const isNight = NIGHT_STAGES.has(stageId);
    const bin = new BinaryCollector();
    const materials = [];
    const matIndexByName = /* @__PURE__ */ new Map();
    const ensureMaterial = (name, baseColor, matOptions = {}) => {
      if (matIndexByName.has(name)) return matIndexByName.get(name);
      const idx = materials.length;
      const stk = materialStkExtras(name, matOptions);
      const rgba = stk.tint ? hexToRgba(stk.tint) : baseColor;
      materials.push({
        name,
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: rgba,
          metallicFactor: matOptions.metallic ?? 0,
          roughnessFactor: matOptions.roughness ?? 0.9
        },
        extras: {
          stk
        }
      });
      matIndexByName.set(name, idx);
      return idx;
    };
    const groundRgba = look?.ground ? hexToRgba(look.ground) : [
      0.46,
      0.56,
      0.36,
      1
    ];
    const waterRgba = look?.water?.color ? hexToRgba(look.water.color) : [
      0.14,
      0.42,
      0.62,
      1
    ];
    const foamRgba = look?.water?.foam ? hexToRgba(look.water.foam) : [
      0.92,
      0.97,
      0.99,
      1
    ];
    const roadMatIdx = ensureMaterial("bRoadMat", [
      ROAD_ALBEDO,
      ROAD_ALBEDO,
      ROAD_ALBEDO,
      1
    ], {
      roughness: 0.85
    });
    const groundMatIdx = ensureMaterial("bGroundMat", groundRgba, {
      roughness: 0.95
    });
    const rumbleMatIdx = ensureMaterial("bRumbleRedMat", hexToRgba("#ECEFF1"), {
      roughness: 0.8
    });
    const waterMatIdx = ensureMaterial("bWaterMat", waterRgba, {
      roughness: 0.15
    });
    const foamMatIdx = ensureMaterial("bFoamMat", foamRgba, {
      roughness: 0.35
    });
    const promenadeMatIdx = ensureMaterial("bPromenadeMat", hexToRgba(PROMENADE.paving), {
      roughness: 0.85
    });
    const seaWallMatIdx = ensureMaterial("bSeaWallMat", hexToRgba(PROMENADE.face), {
      roughness: 0.85
    });
    ensureMaterial("prop#cactus", hexToRgba(MATERIAL_TINTS.cactus), {});
    ensureMaterial("prop#cactus_tip", hexToRgba(MATERIAL_TINTS.cactus_tip), {});
    ensureMaterial("cypress#foliage", [
      0.22,
      0.42,
      0.24,
      1
    ], {
      modelKey: "cypress"
    });
    ensureMaterial("tree-broadleaf-a#foliage", [
      0.26,
      0.48,
      0.24,
      1
    ], {
      modelKey: "tree-broadleaf-a"
    });
    ensureMaterial("palm#frond", [
      0.24,
      0.5,
      0.22,
      1
    ], {
      modelKey: "palm"
    });
    ensureMaterial("verge#grass", [
      0.3,
      0.54,
      0.25,
      1
    ], {
      modelKey: "verge"
    });
    ensureMaterial("castle-tower#iron", [
      0.25,
      0.26,
      0.28,
      1
    ], {
      modelKey: "castle-tower"
    });
    ensureMaterial("landmark#painted", [
      0.85,
      0.78,
      0.68,
      1
    ], {
      painted: true
    });
    ensureMaterial("bCloudMat", [
      0.98,
      0.94,
      0.86,
      1
    ], {
      cloud: true,
      roughness: 0.95
    });
    ensureMaterial("kart_hero_paint", [
      0.86,
      0.14,
      0.14,
      1
    ], {
      metallic: 0.1,
      roughness: 0.18
    });
    const texSize = options.textureSize ?? 16;
    const images = [];
    const textures = [];
    const encodeRgbaToPng = (width, height, rgba) => {
      const rawRowLen = width * 4 + 1;
      const rawData = new Uint8Array(rawRowLen * height);
      for (let y = 0; y < height; y++) {
        const rowStart = y * rawRowLen;
        rawData[rowStart] = 0;
        rawData.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
      }
      const len = rawData.byteLength;
      const zlib = new Uint8Array(2 + 5 + len + 4);
      zlib[0] = 120;
      zlib[1] = 1;
      zlib[2] = 1;
      zlib[3] = len & 255;
      zlib[4] = len >>> 8 & 255;
      const nlen = ~len & 65535;
      zlib[5] = nlen & 255;
      zlib[6] = nlen >>> 8 & 255;
      zlib.set(rawData, 7);
      let s1 = 1;
      let s2 = 0;
      for (let i = 0; i < len; i++) {
        s1 = (s1 + rawData[i]) % 65521;
        s2 = (s2 + s1) % 65521;
      }
      const adler = (s2 << 16 | s1) >>> 0;
      const adlerOff = 7 + len;
      zlib[adlerOff] = adler >>> 24 & 255;
      zlib[adlerOff + 1] = adler >>> 16 & 255;
      zlib[adlerOff + 2] = adler >>> 8 & 255;
      zlib[adlerOff + 3] = adler & 255;
      const crc32 = (bytes) => {
        let c = 4294967295;
        for (let i = 0; i < bytes.length; i++) {
          c ^= bytes[i];
          for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
        }
        return (c ^ 4294967295) >>> 0;
      };
      const makeChunk = (typeStr, data) => {
        const out = new Uint8Array(12 + data.length);
        const dv = new DataView(out.buffer);
        dv.setUint32(0, data.length, false);
        for (let i = 0; i < 4; i++) out[4 + i] = typeStr.charCodeAt(i);
        out.set(data, 8);
        dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
        return out;
      };
      const ihdr = new Uint8Array(13);
      const ihdrDv = new DataView(ihdr.buffer);
      ihdrDv.setUint32(0, width, false);
      ihdrDv.setUint32(4, height, false);
      ihdr[8] = 8;
      ihdr[9] = 6;
      const sig = new Uint8Array([
        137,
        80,
        78,
        71,
        13,
        10,
        26,
        10
      ]);
      const cIhdr = makeChunk("IHDR", ihdr);
      const cIdat = makeChunk("IDAT", zlib);
      const cIend = makeChunk("IEND", new Uint8Array(0));
      const png = new Uint8Array(sig.length + cIhdr.length + cIdat.length + cIend.length);
      png.set(sig, 0);
      png.set(cIhdr, sig.length);
      png.set(cIdat, sig.length + cIhdr.length);
      png.set(cIend, sig.length + cIhdr.length + cIdat.length);
      return png;
    };
    const embedRgbaTexture = (name, rgbaObj) => {
      const pngBytes = encodeRgbaToPng(rgbaObj.width, rgbaObj.height, rgbaObj.pixels);
      const viewIndex = bin.addBytes(pngBytes);
      const imgIndex = images.length;
      images.push({
        name,
        bufferView: viewIndex,
        mimeType: "image/png",
        extras: {
          width: rgbaObj.width,
          height: rgbaObj.height,
          format: "RGBA8"
        }
      });
      const texIndex = textures.length;
      textures.push({
        name,
        source: imgIndex
      });
      return texIndex;
    };
    embedRgbaTexture("frondTexture", frondTexture(texSize, texSize));
    embedRgbaTexture("waveNormals", waveNormals(texSize, texSize, 23));
    embedRgbaTexture("brushStrokes", brushStrokes(texSize, 7, 64));
    if (art.carpet) {
      embedRgbaTexture("flowerCarpet", flowerCarpet(texSize, 42, art.carpet));
    }
    const baseY = Math.min(...pts.map((p) => p.y)) - 2;
    const waterY = baseY - 1;
    const zEnd = pts[pts.length - 1]?.z ?? Infinity;
    const isWet = (side) => shoreSide !== 0 && shoreSide < 0 === side < 0;
    const groundY = (p, side, offset) => terrainHeightAt(stageId, p, baseY, waterY, side, offset, isWet(side), zEnd);
    const fullPts = [
      ...leadPts.slice(0, -1),
      ...pts,
      ...leadOutPts.slice(1)
    ];
    const fullRights = [
      ...leadRights.slice(0, -1),
      ...rights,
      ...leadOutRights.slice(1)
    ];
    const endDiv = forkDiverge[forkDiverge.length - 1] ?? 0;
    const fullDiverge = [
      ...leadPts.slice(0, -1).map(() => 0),
      ...forkDiverge,
      ...leadOutPts.slice(1).map(() => endDiv)
    ];
    const trunkPts = stage.fork && forkStart < pts.length ? [
      ...leadPts.slice(0, -1),
      ...pts.slice(0, Math.min(pts.length, forkStart + 2))
    ] : fullPts;
    const trunkRights = stage.fork && forkStart < pts.length ? [
      ...leadRights.slice(0, -1),
      ...rights.slice(0, Math.min(pts.length, forkStart + 2))
    ] : fullRights;
    const leftPath = [];
    const rightPath = [];
    for (let i = 0; i < trunkPts.length; i++) {
      const p = trunkPts[i];
      const b = trunkRights[i];
      leftPath.push({
        x: p.x - b.x * halfW,
        y: p.y + 0.02,
        z: p.z - b.z * halfW
      });
      rightPath.push({
        x: p.x + b.x * halfW,
        y: p.y + 0.02,
        z: p.z + b.z * halfW
      });
    }
    const leftRumbleInner = [];
    const leftRumbleOuter = [];
    const rightRumbleInner = [];
    const rightRumbleOuter = [];
    for (let i = 0; i < fullPts.length; i++) {
      const p = fullPts[i];
      const b = fullRights[i];
      const div = fullDiverge[i];
      leftRumbleInner.push({
        x: p.x - b.x * (div + halfW),
        y: p.y + 0.025,
        z: p.z - b.z * (div + halfW)
      });
      leftRumbleOuter.push({
        x: p.x - b.x * (div + rumbleW),
        y: p.y + 0.015,
        z: p.z - b.z * (div + rumbleW)
      });
      rightRumbleInner.push({
        x: p.x + b.x * (div + halfW),
        y: p.y + 0.025,
        z: p.z + b.z * (div + halfW)
      });
      rightRumbleOuter.push({
        x: p.x + b.x * (div + rumbleW),
        y: p.y + 0.015,
        z: p.z + b.z * (div + rumbleW)
      });
    }
    const buildBandPaths = (side, offsets) => {
      const paths = offsets.map((offset) => fullPts.map((p, i) => {
        const b = fullRights[i];
        const d = rumbleW + fullDiverge[i] + offset;
        return {
          x: p.x + side * b.x * d,
          y: groundY(p, side, offset),
          z: p.z + side * b.z * d
        };
      }));
      return side > 0 ? paths.reverse() : paths;
    };
    const meshes = [];
    const nodes = [];
    const addRibbonNode = (name, pathA, pathB, matIdx, extras = {}) => {
      const meshIdx = meshes.length;
      meshes.push({
        name,
        primitives: [
          buildRibbonPrimitive(bin, pathA, pathB, matIdx)
        ]
      });
      const nodeIdx = nodes.length;
      nodes.push({
        name,
        mesh: meshIdx,
        extras
      });
      return nodeIdx;
    };
    const addMultiBandNode = (name, paths, matIdx, extras = {}) => {
      const meshIdx = meshes.length;
      meshes.push({
        name,
        primitives: [
          buildMultiBandRibbonPrimitive(bin, paths, matIdx)
        ]
      });
      const nodeIdx = nodes.length;
      nodes.push({
        name,
        mesh: meshIdx,
        extras
      });
      return nodeIdx;
    };
    addRibbonNode("bRoad", leftPath, rightPath, roadMatIdx, {
      role: "road",
      textureSet: art.road
    });
    addRibbonNode("bRumbleL", leftRumbleInner, leftRumbleOuter, rumbleMatIdx, {
      role: "rumble-left"
    });
    addRibbonNode("bRumbleR", rightRumbleOuter, rightRumbleInner, rumbleMatIdx, {
      role: "rumble-right"
    });
    const leftOffsets = isWet(-1) ? WET_TERRAIN_OFFSETS : DRY_TERRAIN_OFFSETS;
    const rightOffsets = isWet(1) ? WET_TERRAIN_OFFSETS : DRY_TERRAIN_OFFSETS;
    addMultiBandNode("bTerrainL", buildBandPaths(-1, leftOffsets), groundMatIdx, {
      role: "terrain-left",
      textureSet: art.ground
    });
    addMultiBandNode("bTerrainR", buildBandPaths(1, rightOffsets), groundMatIdx, {
      role: "terrain-right",
      textureSet: art.ground
    });
    if (art.carpet && art.carpet.length > 0) {
      const carpetMatIdx = ensureMaterial("bCarpet", hexToRgba(art.carpet[0]), {
        roughness: 0.95
      });
      for (const side of [
        -1,
        1
      ]) {
        const carpetInner = [];
        const carpetOuter = [];
        for (let i = 0; i < fullPts.length; i++) {
          const p = fullPts[i];
          const b = fullRights[i];
          const div = fullDiverge[i];
          const dIn = rumbleW + div + 0.4;
          const dOut = rumbleW + div + 6;
          carpetInner.push({
            x: p.x + side * b.x * dIn,
            y: p.y + 0.05,
            z: p.z + side * b.z * dIn
          });
          carpetOuter.push({
            x: p.x + side * b.x * dOut,
            y: p.y + 0.05,
            z: p.z + side * b.z * dOut
          });
        }
        if (side < 0) {
          addRibbonNode("bCarpetL", carpetInner, carpetOuter, carpetMatIdx, {
            role: "carpet-left"
          });
        } else {
          addRibbonNode("bCarpetR", carpetOuter, carpetInner, carpetMatIdx, {
            role: "carpet-right"
          });
        }
      }
    }
    if (stage.fork && forkStart < pts.length) {
      const forkPts = [
        ...pts.slice(forkStart),
        ...leadOutPts.slice(1)
      ];
      const forkRights = [
        ...rights.slice(forkStart),
        ...leadOutRights.slice(1)
      ];
      const forkDivs = [
        ...forkDiverge.slice(forkStart),
        ...leadOutPts.slice(1).map(() => endDiv)
      ];
      const forkLeftRoadL = [];
      const forkLeftRoadR = [];
      const forkRightRoadL = [];
      const forkRightRoadR = [];
      const forkDivL = [];
      const forkDivR = [];
      const forkInnerRumbleLL = [];
      const forkInnerRumbleLR = [];
      const forkInnerRumbleRL = [];
      const forkInnerRumbleRR = [];
      for (let i = 0; i < forkPts.length; i++) {
        const p = forkPts[i];
        const b = forkRights[i];
        const diverge = forkDivs[i];
        const gap = Math.max(0, diverge - 0.6);
        const at = (offset, lift) => ({
          x: p.x + b.x * offset,
          y: p.y + lift,
          z: p.z + b.z * offset
        });
        forkLeftRoadL.push(at(-(diverge + rumbleW), 0.03));
        forkLeftRoadR.push(at(-gap, 0.03));
        forkRightRoadL.push(at(gap, 0.03));
        forkRightRoadR.push(at(diverge + rumbleW, 0.03));
        forkDivL.push(at(-gap, 0.015));
        forkDivR.push(at(gap, 0.015));
        if (gap > 0.01) {
          forkInnerRumbleLL.push(at(-(gap + 0.55), 0.035));
          forkInnerRumbleLR.push(at(-gap, 0.035));
          forkInnerRumbleRL.push(at(gap, 0.035));
          forkInnerRumbleRR.push(at(gap + 0.55, 0.035));
        }
      }
      addRibbonNode("bForkRoadL", forkLeftRoadL, forkLeftRoadR, roadMatIdx, {
        role: "fork-left"
      });
      addRibbonNode("bForkRoadR", forkRightRoadL, forkRightRoadR, roadMatIdx, {
        role: "fork-right"
      });
      addRibbonNode("bForkDivider", forkDivR, forkDivL, groundMatIdx, {
        role: "fork-divider"
      });
      if (forkInnerRumbleLL.length >= 2) {
        addRibbonNode("bForkRumbleL", forkInnerRumbleLL, forkInnerRumbleLR, rumbleMatIdx, {
          role: "rumble-fork-left"
        });
        addRibbonNode("bForkRumbleR", forkInnerRumbleRL, forkInnerRumbleRR, rumbleMatIdx, {
          role: "rumble-fork-right"
        });
      }
    }
    if (shoreSide !== 0) {
      const seaWallTopMatIdx = ensureMaterial("bSeaWallTopMat", hexToRgba(PROMENADE.top), {
        roughness: 0.85
      });
      const seaWallBackMatIdx = ensureMaterial("bSeaWallBackMat", hexToRgba("#A89C86"), {
        roughness: 0.9
      });
      const promInner = [];
      const promOuter = [];
      const wallTopInner = [];
      const wallTopOuter = [];
      const wallBackBot = [];
      const foamInner = [];
      const foamOuter = [];
      const waterBands = WATER_OFFSETS.map(() => []);
      for (let i = 0; i < fullPts.length; i++) {
        const p = fullPts[i];
        const b = fullRights[i];
        const div = fullDiverge[i];
        const s = shoreSide;
        const rEdge = s * (rumbleW + div);
        const wInner = s * (rumbleW + div + SEA_WALL.wall);
        const wOuter = s * (rumbleW + div + SEA_WALL.out);
        const shoreInner = s * (rumbleW + div + SHORE - 2.2);
        const shoreFoamOuter = s * (rumbleW + div + SHORE + 5.8);
        promInner.push({
          x: p.x + b.x * rEdge,
          y: p.y + 0.03,
          z: p.z + b.z * rEdge
        });
        promOuter.push({
          x: p.x + b.x * wInner,
          y: p.y + 0.05,
          z: p.z + b.z * wInner
        });
        wallTopInner.push({
          x: p.x + b.x * wInner,
          y: p.y + SEA_WALL.height,
          z: p.z + b.z * wInner
        });
        wallTopOuter.push({
          x: p.x + b.x * wOuter,
          y: p.y + SEA_WALL.height,
          z: p.z + b.z * wOuter
        });
        wallBackBot.push({
          x: p.x + b.x * wOuter,
          y: p.y - 1.5,
          z: p.z + b.z * wOuter
        });
        foamInner.push({
          x: p.x + b.x * shoreInner,
          y: waterY + 0.1,
          z: p.z + b.z * shoreInner
        });
        foamOuter.push({
          x: p.x + b.x * shoreFoamOuter,
          y: waterY + 0.04,
          z: p.z + b.z * shoreFoamOuter
        });
        for (let bi = 0; bi < WATER_OFFSETS.length; bi++) {
          const seaOff = s * (rumbleW + div + SHORE + WATER_OFFSETS[bi]);
          waterBands[bi].push({
            x: p.x + b.x * seaOff,
            y: waterY,
            z: p.z + b.z * seaOff
          });
        }
      }
      addRibbonNode("bPromenade", promInner, promOuter, promenadeMatIdx, {
        role: "promenade",
        shoreSide
      });
      addRibbonNode("bSeaWallFace", promOuter, wallTopInner, seaWallMatIdx, {
        role: "sea-wall-face",
        shoreSide
      });
      addRibbonNode("bSeaWall", wallTopInner, wallTopOuter, seaWallTopMatIdx, {
        role: "sea-wall",
        shoreSide
      });
      addRibbonNode("bSeaWallBack", wallTopOuter, wallBackBot, seaWallBackMatIdx, {
        role: "sea-wall-back",
        shoreSide
      });
      addRibbonNode("bFoam", foamInner, foamOuter, foamMatIdx, {
        role: "foam",
        shoreSide
      });
      addMultiBandNode("bWater", shoreSide < 0 ? waterBands : [
        ...waterBands
      ].reverse(), waterMatIdx, {
        role: "water",
        shoreSide
      });
    }
    const foliageMatIdx = matIndexByName.get("palm#frond");
    if (foliageMatIdx === void 0) {
      throw new Error("stage_gltf: missing palm#frond material");
    }
    const unitProxyPrimitive = buildUnitProxyPrimitive(bin, foliageMatIdx);
    const meshIndexByKind = /* @__PURE__ */ new Map();
    const ensureKindMesh = (kind) => {
      const existing = meshIndexByKind.get(kind);
      if (existing !== void 0) return existing;
      const parts = kind.split(":");
      const meshName = parts[0] === "prop" && parts[2] ? `model/${parts[2]}/lod0` : parts[0] === "prop" ? `model/${parts[1]}/lod0` : `scatter/${parts[1]}`;
      const idx = meshes.length;
      meshes.push({
        name: meshName,
        primitives: [
          unitProxyPrimitive
        ],
        extras: {
          kind
        }
      });
      meshIndexByKind.set(kind, idx);
      return idx;
    };
    const rawProps = placeProps(stageId, stage.segmentCount, forkStart);
    const seaSide = art.seaWall ? shoreSide : 0;
    const isOnPromenade = (pl) => pl.side === seaSide && pl.offset < SEA_WALL.out && (pl.kind === "grassTuft" || pl.kind === "shrub");
    const props = rawProps.filter((pl) => !isOnPromenade(pl));
    const vergeItems = scatterVerge(stageId, stage.segmentCount, segLen);
    const chunkBuckets = /* @__PURE__ */ new Map();
    const addInstance = (segIdx, kind, worldX, worldY, worldZ, yaw, scaleX, scaleY, scaleZ) => {
      const clampedSeg = Math.max(0, Math.min(stage.segmentCount - 1, Math.floor(segIdx)));
      const chunkIndex = Math.floor(clampedSeg / SCATTER_CHUNK);
      const key = `${chunkIndex}:${kind}`;
      let bucket = chunkBuckets.get(key);
      if (!bucket) {
        const startSeg = chunkIndex * SCATTER_CHUNK;
        const endSeg = Math.min(stage.segmentCount - 1, startSeg + SCATTER_CHUNK - 1);
        bucket = {
          chunkIndex,
          kind,
          startSegment: startSeg,
          endSegment: endSeg,
          zMin: Math.min(pts[startSeg].z, worldZ),
          zMax: Math.max(pts[endSeg].z + segLen, worldZ),
          translations: [],
          rotations: [],
          scales: []
        };
        chunkBuckets.set(key, bucket);
      } else {
        bucket.zMin = Math.min(bucket.zMin, worldZ);
        bucket.zMax = Math.max(bucket.zMax, worldZ);
      }
      bucket.translations.push(worldX, worldY, worldZ);
      const q = yawToQuat(yaw);
      bucket.rotations.push(q[0], q[1], q[2], q[3]);
      bucket.scales.push(scaleX, scaleY, scaleZ);
    };
    const spotProp = (p) => {
      const segIdx = Math.max(0, Math.min(pts.length - 1, p.i));
      const nextIdx = Math.min(pts.length - 1, segIdx + 1);
      const pt = pts[segIdx];
      const nextPt = pts[nextIdx];
      const rt = rights[segIdx];
      const scale = p.scale || 1;
      const offset = p.offset || 0;
      const reach = (PROP_FOOTPRINT[p.kind] ?? 0) * scale;
      const d = p.side === 0 ? 0 : rumbleW + forkDiverge[segIdx] + offset;
      let wy = pt.y;
      if (p.kind === "sailboat") {
        wy = waterY;
      } else if (p.side !== 0) {
        const span = Math.ceil(reach / segLen);
        wy = Infinity;
        for (let j = Math.max(0, segIdx - span); j <= Math.min(pts.length - 1, segIdx + span); j++) {
          for (const o of [
            offset - reach,
            offset,
            offset + reach
          ]) {
            wy = Math.min(wy, groundY(pts[j], p.side, o));
          }
        }
        if (!Number.isFinite(wy)) wy = groundY(pt, p.side, offset);
        if (p.kind === "shrub" || p.kind === "grassTuft") wy -= 0.06;
      }
      wy += p.lift || 0;
      const wx = pt.x + p.side * rt.x * d;
      const wz = pt.z + p.side * rt.z * d;
      const roadYaw = Math.atan2(nextPt.x - pt.x, nextPt.z - pt.z) + (p.side < 0 ? Math.PI : 0);
      const baseYaw = p.yaw ?? roadYaw;
      return {
        segIdx,
        wx,
        wy,
        wz,
        baseYaw,
        scale
      };
    };
    const leadSegs = leadPts.length - 1;
    const p0 = pts[0];
    const emitProp = (p, n, models, scales, behind = false) => {
      let { segIdx, wx, wy, wz, baseYaw, scale } = spotProp(p);
      if (behind) {
        const pt = pts[segIdx];
        wx = wx + 2 * (p0.x - pt.x);
        wy = wy - pt.y + p0.y;
        wz = wz + 2 * (p0.z - pt.z);
      } else if (p.side !== 0 && stage.fork && segIdx >= Math.max(0, forkStart - 6)) {
        const pt = pts[segIdx];
        const rt = rights[segIdx];
        const lat = Math.abs((wx - pt.x) * rt.x + (wz - pt.z) * rt.z);
        if (lat < rumbleW + forkDiverge[segIdx] + 2.8) return;
      }
      const targetSeg = behind ? 0 : segIdx;
      if (models && scales) {
        const modelId = models[n % models.length];
        const sc = scale * scales[n % models.length];
        const yaw = baseYaw + (MODEL_TURN[modelId] ?? 0);
        addInstance(targetSeg, `prop:${p.kind}:${modelId}`, wx, wy, wz, yaw, sc, sc, sc);
      } else {
        addInstance(targetSeg, `prop:${p.kind}`, wx, wy, wz, baseYaw, scale, scale, scale);
      }
    };
    look.props.forEach((spec, k) => {
      const ours = props.filter((pl) => pl.k === k);
      const models = art.models?.[spec.kind];
      const scales = models ? modelScales(manifest_default, spec.kind, models) : null;
      ours.forEach((p, n) => {
        emitProp(p, n, models, scales, false);
        if (p.i <= leadSegs && !p.landmark) {
          emitProp(p, n, models, scales, true);
        }
      });
    });
    if (look.destination && leadOutPts.length > 1) {
      const endPt = leadOutPts[0];
      const nextEnd = leadOutPts[1];
      const endLen = Math.hypot(nextEnd.x - endPt.x, nextEnd.z - endPt.z) || 1;
      const onX = (nextEnd.x - endPt.x) / endLen;
      const onZ = (nextEnd.z - endPt.z) / endLen;
      const b = leadOutRights[0];
      const destYaw = Math.atan2(-onX, -onZ);
      for (const piece of look.destination) {
        const models = art.models?.[piece.kind];
        if (!models) continue;
        const [modelId] = models;
        const sc = (piece.scale || 1) * modelScales(manifest_default, piece.kind, models)[0];
        const wx = endPt.x + onX * piece.beyond + b.x * piece.across;
        const wy = endPt.y - 0.05;
        const wz = endPt.z + onZ * piece.beyond + b.z * piece.across;
        const yaw = destYaw + (MODEL_TURN[modelId] ?? 0);
        addInstance(pts.length - 1, `prop:${piece.kind}:${modelId}`, wx, wy, wz, yaw, sc, sc, sc);
      }
    }
    if (stage.fork && forkStart < pts.length) {
      const gPt = pts[forkStart];
      const gYaw = headings[forkStart];
      addInstance(forkStart, "prop:forkGantry", gPt.x, gPt.y, gPt.z, gYaw, halfW, 1, 1);
      const archZ = (stage.segmentCount * stage.segmentLength - ARCH_LEAD) * METRES_PER_UNIT;
      const archSeg = Math.max(forkStart, Math.min(pts.length - 1, Math.floor(archZ / segLen)));
      const aPt = pts[archSeg];
      const aRt = rights[archSeg];
      const aYaw = headings[archSeg];
      const aDiv = forkDiverge[archSeg];
      for (const side of [
        -1,
        1
      ]) {
        const shift = side * (aDiv + 0.45 * rumbleW);
        addInstance(archSeg, side < 0 ? "prop:checkpointArchL" : "prop:checkpointArchR", aPt.x + aRt.x * shift, aPt.y, aPt.z + aRt.z * shift, aYaw, halfW * 0.55, 1, 1);
      }
    } else {
      const finIdx = pts.length - 1;
      const finPt = pts[finIdx];
      const finYaw = headings[finIdx];
      addInstance(finIdx, "prop:finishGantry", finPt.x, finPt.y, finPt.z, finYaw, halfW, 1, 1);
    }
    const palette = VERGE_SCATTER[stageId];
    if (!palette) {
      throw new Error(`stage_gltf: missing VERGE_SCATTER palette for stage "${stageId}"`);
    }
    for (let vi = 0; vi < vergeItems.length; vi++) {
      const v = vergeItems[vi];
      const isBlossom = v.kind === "flower" || v.kind === "poppies";
      if (!isBlossom && vi % 2 !== 0) continue;
      const segIdx = Math.max(0, Math.min(pts.length - 1, v.i));
      const nextIdx = Math.min(pts.length - 1, segIdx + 1);
      let offset = v.offset;
      if (shoreSide !== 0 && v.side === shoreSide && offset < SEA_WALL.out + 0.3) {
        const bed = promenadeBed(v.kind);
        if (bed === null) continue;
        offset = bed;
      }
      const pt = pts[segIdx];
      const qt = pts[nextIdx];
      const rt = rights[segIdx];
      const along = v.along || 0;
      const d = rumbleW + forkDiverge[segIdx] + offset;
      const wx = pt.x + (qt.x - pt.x) * along + v.side * rt.x * d;
      const sink = v.kind === "bush" || v.kind === "tuft" ? -0.06 : 0;
      const wy = groundY(pt, v.side, offset) * (1 - along) + groundY(qt, v.side, offset) * along + sink;
      const wz = pt.z + (qt.z - pt.z) * along + v.side * rt.z * d;
      if (stage.fork && segIdx >= Math.max(0, forkStart - 6)) {
        const lat = Math.abs((wx - pt.x) * rt.x + (wz - pt.z) * rt.z);
        if (lat < rumbleW + forkDiverge[segIdx] + 2.8) continue;
      }
      const sc = v.size;
      const paletteEntry = palette[v.k];
      if (!paletteEntry) {
        throw new Error(`stage_gltf: missing VERGE_SCATTER palette entry ${v.k} for stage "${stageId}"`);
      }
      const colour = paletteEntry.colour;
      addInstance(segIdx, `scatter:${v.kind}:${colour}`, wx, wy, wz, v.yaw || 0, sc, sc, sc);
      if (segIdx < leadSegs) {
        addInstance(0, `scatter:${v.kind}:${colour}`, wx - 2 * (pt.x - p0.x), wy - pt.y + p0.y, wz - 2 * (pt.z - p0.z), v.yaw || 0, sc, sc, sc);
      }
    }
    for (const bucket of chunkBuckets.values()) {
      const instanceCount = bucket.translations.length / 3;
      if (instanceCount === 0) continue;
      const transAcc = bin.addFloatAccessor(new Float32Array(bucket.translations), "VEC3", instanceCount);
      const rotAcc = bin.addFloatAccessor(new Float32Array(bucket.rotations), "VEC4", instanceCount);
      const scaleAcc = bin.addFloatAccessor(new Float32Array(bucket.scales), "VEC3", instanceCount);
      const kindMeshIdx = ensureKindMesh(bucket.kind);
      nodes.push({
        name: `chunk_${bucket.chunkIndex}_${bucket.kind}`,
        mesh: kindMeshIdx,
        extensions: {
          EXT_mesh_gpu_instancing: {
            attributes: {
              TRANSLATION: transAcc,
              ROTATION: rotAcc,
              SCALE: scaleAcc
            }
          }
        },
        extras: {
          chunkIndex: bucket.chunkIndex,
          startSegment: bucket.startSegment,
          endSegment: bucket.endSegment,
          zMin: bucket.zMin,
          zMax: bucket.zMax,
          kind: bucket.kind,
          instanceCount
        }
      });
    }
    const cloudSeen = /* @__PURE__ */ new Set();
    const cloudCards = [];
    let cloudCardIdx = 0;
    if (!isNight) {
      CLOUD_BANKS.forEach((bank, bankIdx) => {
        for (let slot = 0; slot < bank.cards; slot++) {
          const cLook = cloudLook(stageId, cloudCardIdx++);
          const mirrored = cloudSeen.has(cLook.kind);
          cloudSeen.add(cLook.kind);
          const aspect = CLOUD_KINDS[cLook.kind];
          const roll = (n) => (Math.imul(cLook.seed, 2654435761) >>> n & 1023) / 1023;
          const metres = bank.metres[0] + (bank.metres[1] - bank.metres[0]) * roll(3);
          const along = (slot + 0.15 + 0.7 * roll(7)) / bank.cards * bank.span;
          const side = (slot % 2 ? 1 : -1) * bank.distance * (0.45 + 0.6 * roll(13));
          const tall = cLook.kind === "bank" || cLook.kind === "ridge" ? 0.6 : 1;
          const rise = metres * tall / 2;
          cloudCards.push({
            bank: bankIdx,
            slot,
            seed: cLook.seed,
            kind: cLook.kind,
            mirrored,
            metres,
            along,
            side,
            rise,
            width: metres * aspect * tall,
            height: metres * tall,
            span: bank.span,
            lift: bank.lift,
            haze: bank.haze
          });
        }
      });
    }
    const binBytes = bin.finish();
    const gltf = {
      asset: {
        version: "2.0",
        generator: "apexrun/stage_gltf.js"
      },
      extensionsUsed: [
        "EXT_mesh_gpu_instancing"
      ],
      scene: 0,
      scenes: [
        {
          name: stageId,
          nodes: nodes.map((_, idx) => idx),
          extras: {
            stk: {
              stageId,
              stageName: stage.name,
              segmentCount: stage.segmentCount,
              segmentLengthMetres: segLen,
              scatterChunkSegments: SCATTER_CHUNK,
              scatterBehindMetres: SCATTER_BEHIND,
              scatterAheadMetres: SCATTER_AHEAD,
              leadInMetres: LEAD_IN_METRES,
              leadOutMetres: LEAD_OUT_METRES,
              runOnMetres: runOnMetres(stageId),
              lodFarMetres: LOD_FAR,
              lodSplitsMetres: LOD_SPLITS,
              lodMinSizeMetres: LOD_SIZE,
              isNight,
              shoreSide,
              skyKtx2: `sky/${art.sky}.ktx2`,
              backdropLayers: BACKDROP_LAYERS.map((layer) => `backdrop/${art.backdrop || art.sky}/${layer}.ktx2`),
              cloudCards,
              style: STYLE,
              grade: GRADE,
              destination: STAGE_LOOKS[stageId]?.destination ?? null,
              lookColors: {
                ground: look.ground,
                lightGround: look.light.ground,
                fogDensity: look.fog.density,
                water: look.water?.color ?? null,
                sun: look.sun?.color ?? null
              }
            }
          }
        }
      ],
      nodes,
      meshes,
      materials,
      textures,
      images,
      accessors: bin.accessors,
      bufferViews: bin.bufferViews,
      buffers: [
        {
          byteLength: binBytes.byteLength
        }
      ]
    };
    const glb = packGlb(gltf, binBytes);
    return {
      gltf,
      bin: binBytes,
      glb
    };
  }

  // apps/apexrun/shell/engine/pose_buffer.js
  var BODY_PIVOT_Y = 0.32;
  var HAZE_DENSITY = 0.012;
  var MAX_TRAFFIC_CARS = 12;
  var TRAFFIC_STRIDE = 8;
  var EQ_BANDS = 6;
  var POSE_LAYOUT = Object.freeze({
    // Header (0..3)
    TICK: 0,
    ALPHA: 1,
    WIND_TIME: 2,
    STAGE_NUM: 3,
    // Camera (4..11)
    CAM_EYE_X: 4,
    CAM_EYE_Y: 5,
    CAM_EYE_Z: 6,
    CAM_TARGET_X: 7,
    CAM_TARGET_Y: 8,
    CAM_TARGET_Z: 9,
    CAM_FOV: 10,
    CAM_ASPECT: 11,
    // Atmosphere & post-process (12..19)
    STAGE_HAZE: 12,
    HAZE_DENSITY: 13,
    SUN_HAZE_R: 14,
    SUN_HAZE_G: 15,
    SUN_HAZE_B: 16,
    SPEED_BLUR: 17,
    GOD_RAY_INTENSITY: 18,
    EXPOSURE: 19,
    // Hero car transform & procedural rig (20..35)
    HERO_X: 20,
    HERO_Y: 21,
    HERO_Z: 22,
    HERO_YAW: 23,
    HERO_PITCH: 24,
    HERO_ROLL: 25,
    HERO_BODY_PITCH: 26,
    HERO_BODY_ROLL: 27,
    HERO_BODY_PIVOT_Y: 28,
    HERO_STRETCH: 29,
    HERO_WHEEL_STEER: 30,
    HERO_WHEEL_SPIN: 31,
    HERO_DRIFT_DIR: 32,
    HERO_DRIFT_INTENSITY: 33,
    HERO_NITRO_FLAME: 34,
    HERO_HEADLIGHTS_ON: 35,
    // Riders procedural rig (36..41)
    RIDER_PASSENGER_ARM: 36,
    RIDER_PASSENGER_HEAD_YAW: 37,
    RIDER_GIRL_ARM_RAISE: 38,
    RIDER_GIRL_ARM_OUT: 39,
    RIDER_GIRL_ARM_SWING: 40,
    RIDER_GIRL_WAVING: 41,
    // Rival car transform (42..51)
    RIVAL_ACTIVE: 42,
    RIVAL_X: 43,
    RIVAL_Y: 44,
    RIVAL_Z: 45,
    RIVAL_YAW: 46,
    RIVAL_PITCH: 47,
    RIVAL_ROLL: 48,
    RIVAL_WHEEL_SPIN: 49,
    RIVAL_SPEED: 50,
    RIVAL_BEATEN: 51,
    // Flagman procedural rig (52..57)
    MARSHAL_ARM: 52,
    MARSHAL_FLAG: 53,
    MARSHAL_X: 54,
    MARSHAL_Y: 55,
    MARSHAL_Z: 56,
    MARSHAL_YAW: 57,
    // Moments / Replay overlay state (58..67)
    MOMENT_HAZE: 58,
    MOMENT_SWOOP_STAGE: 59,
    MOMENT_COUNTDOWN_CODE: 60,
    MOMENT_CLEAR_STAGE: 61,
    MOMENT_CLEAR_BEATEN: 62,
    MOMENT_CLEAR_SKIP: 63,
    MOMENT_ENDING_CLEARED: 64,
    MOMENT_REPLAY_ACTIVE: 65,
    MOMENT_REPLAY_TRIP_ALPHA: 66,
    MOMENT_REPLAY_STAGE_ALPHA: 67,
    // Fast HUD telemetry (68..89)
    HUD_SPEED_KMH: 68,
    HUD_RPM: 69,
    HUD_TACHO_RATIO: 70,
    HUD_GEAR: 71,
    HUD_NITRO_AMOUNT: 72,
    HUD_NITRO_ACTIVE: 73,
    HUD_TIMER_SEC: 74,
    HUD_TIMER_DEC: 75,
    HUD_SCORE: 76,
    HUD_DRIFT_SCORE: 77,
    HUD_GFORCE_LAT: 78,
    HUD_SLIPSTREAM: 79,
    HUD_RIVAL_GAP_METRES: 80,
    HUD_FORK_DIST_METRES: 81,
    HUD_ROUTE_PROGRESS: 82,
    HUD_RADAR_NEAREST_Z: 83,
    HUD_EQ_0: 84,
    HUD_EQ_1: 85,
    HUD_EQ_2: 86,
    HUD_EQ_3: 87,
    HUD_EQ_4: 88,
    HUD_EQ_5: 89,
    // Traffic cars slice (90..185): 12 cars * 8 floats each
    TRAFFIC_BASE: 90
  });
  var POSE_BUFFER_FLOATS = POSE_LAYOUT.TRAFFIC_BASE + MAX_TRAFFIC_CARS * TRAFFIC_STRIDE;
  var POSE_BUFFER_BYTES = POSE_BUFFER_FLOATS * 4;
  var cameraState = {
    boostT: 0,
    hoodT: 0,
    lens: 0.68,
    flameT: 0,
    lastTick: -1
  };
  var centerlineCache = /* @__PURE__ */ new Map();
  function getCachedCenterline(stageId) {
    let entry = centerlineCache.get(stageId);
    if (!entry) {
      entry = buildStageCenterline(stageId);
      centerlineCache.set(stageId, entry);
    }
    return entry;
  }
  function hexToRgb01(hex) {
    if (!hex || typeof hex !== "string") return [
      0.96,
      0.82,
      0.68
    ];
    const clean = hex.replace(/^#/, "");
    const n = parseInt(clean, 16);
    if (Number.isNaN(n)) return [
      0.96,
      0.82,
      0.68
    ];
    return [
      (n >> 16 & 255) / 255,
      (n >> 8 & 255) / 255,
      (n & 255) / 255
    ];
  }
  function encodeCountdownCode(countStr) {
    switch (countStr) {
      case "1":
        return 1;
      case "2":
        return 2;
      case "3":
        return 3;
      case "GO!":
        return 4;
      case "GOAL!":
        return 5;
      case "TIME OVER":
        return 6;
      default:
        return 0;
    }
  }
  function packPoseBuffer(state, options = {}) {
    const out = options.target instanceof Float32Array && options.target.length >= POSE_BUFFER_FLOATS ? options.target : new Float32Array(POSE_BUFFER_FLOATS);
    out.fill(0);
    const alpha = options.alpha ?? 1;
    const aspect = options.aspect ?? 16 / 9;
    const cut = options.cut ?? null;
    const eqLevels = options.eqLevels ?? [
      0,
      0,
      0,
      0,
      0,
      0
    ];
    const stageId = state?.stageId;
    if (!stageId || !OUTRUN_STAGES[stageId]) {
      throw new Error(`packPoseBuffer: unknown or missing stageId "${stageId}"`);
    }
    const centerline = getCachedCenterline(stageId);
    const player = state.karts?.find((k) => k.isPlayer) ?? state.karts?.[0];
    if (!player) {
      throw new Error("packPoseBuffer: state.karts must contain at least one kart");
    }
    const windTime = (state.tick || 0) / 60;
    out[POSE_LAYOUT.TICK] = state.tick || 0;
    out[POSE_LAYOUT.ALPHA] = alpha;
    out[POSE_LAYOUT.WIND_TIME] = windTime;
    out[POSE_LAYOUT.STAGE_NUM] = state.stageNum || 1;
    const playerLx = player.x || 0;
    const heroZMetres = (player.z || 0) * METRES_PER_UNIT;
    const heroPose = sampleRoadPose(centerline, heroZMetres, playerLx);
    const tickNow = state.tick || 0;
    if (state.stageState === "title" || tickNow < cameraState.lastTick) {
      cameraState.boostT = 0;
      cameraState.hoodT = 0;
      cameraState.lens = 0.68;
      cameraState.flameT = 0;
    }
    cameraState.lastTick = tickNow;
    const playerBoosting = !!(player.isNitro || (player.nitroTimer || 0) > 0 || (player.turboTimer || 0) > 0);
    cameraState.boostT += ((playerBoosting ? 1 : 0) - cameraState.boostT) * (playerBoosting ? 0.18 : 0.025);
    cameraState.flameT += ((playerBoosting ? 1 : 0) - cameraState.flameT) * 0.25;
    const boostT = cameraState.boostT;
    const cam = computeCameraPose(state, player, heroPose, (z, x) => sampleRoadPoint(centerline, z, x), centerline.landmarks || [], cameraState, aspect, cut);
    out[POSE_LAYOUT.CAM_EYE_X] = cam.eye[0];
    out[POSE_LAYOUT.CAM_EYE_Y] = cam.eye[1];
    out[POSE_LAYOUT.CAM_EYE_Z] = cam.eye[2];
    out[POSE_LAYOUT.CAM_TARGET_X] = cam.at[0];
    out[POSE_LAYOUT.CAM_TARGET_Y] = cam.at[1];
    out[POSE_LAYOUT.CAM_TARGET_Z] = cam.at[2];
    out[POSE_LAYOUT.CAM_FOV] = cam.fov;
    out[POSE_LAYOUT.CAM_ASPECT] = aspect;
    const sHaze = stageHaze(state, heroZMetres);
    const lookSpec = STAGE_LOOKS[stageId];
    const fogRgb = hexToRgb01(lookSpec?.fog?.color || "#C8E0EA");
    out[POSE_LAYOUT.STAGE_HAZE] = sHaze;
    out[POSE_LAYOUT.HAZE_DENSITY] = (lookSpec?.fog?.density ?? HAZE_DENSITY) * (0.25 + 0.75 * sHaze);
    out[POSE_LAYOUT.SUN_HAZE_R] = fogRgb[0];
    out[POSE_LAYOUT.SUN_HAZE_G] = fogRgb[1];
    out[POSE_LAYOUT.SUN_HAZE_B] = fogRgb[2];
    out[POSE_LAYOUT.SPEED_BLUR] = Math.max(0, Math.min(1, ((player.speed || 0) - 180) / 140)) * 0.035 + boostT * 0.04;
    out[POSE_LAYOUT.GOD_RAY_INTENSITY] = NIGHT_STAGES.has(stageId) ? 0 : 0.45 * (1 - sHaze);
    out[POSE_LAYOUT.EXPOSURE] = 1.05;
    const body = player.body || {
      pitch: 0,
      roll: 0,
      stretch: 0
    };
    const steerInput = player.steerAngle ?? player.steer ?? 0;
    const wheelSteer = steerInput * maxWheel(player.speed || 0);
    const wheelSpin = heroZMetres / 0.34 % (Math.PI * 2);
    out[POSE_LAYOUT.HERO_X] = heroPose.x;
    out[POSE_LAYOUT.HERO_Y] = heroPose.y;
    out[POSE_LAYOUT.HERO_Z] = heroPose.z;
    out[POSE_LAYOUT.HERO_YAW] = heroPose.yaw + (player.heading || 0) + (player.drift ? (player.driftDir || 0) * 0.3 : 0) + (player.spinTimer || 0) * 36 * Math.PI / 180;
    out[POSE_LAYOUT.HERO_PITCH] = heroPose.pitch;
    out[POSE_LAYOUT.HERO_ROLL] = 0;
    out[POSE_LAYOUT.HERO_BODY_PITCH] = body.pitch || 0;
    out[POSE_LAYOUT.HERO_BODY_ROLL] = body.roll || 0;
    out[POSE_LAYOUT.HERO_BODY_PIVOT_Y] = BODY_PIVOT_Y;
    out[POSE_LAYOUT.HERO_STRETCH] = body.stretch || 0;
    out[POSE_LAYOUT.HERO_WHEEL_STEER] = wheelSteer;
    out[POSE_LAYOUT.HERO_WHEEL_SPIN] = wheelSpin;
    out[POSE_LAYOUT.HERO_DRIFT_DIR] = player.drift ? player.driftDir || 0 : 0;
    out[POSE_LAYOUT.HERO_DRIFT_INTENSITY] = player.drift ? Math.min(1, (player.speed || 0) / 220) : 0;
    out[POSE_LAYOUT.HERO_NITRO_FLAME] = cameraState.flameT;
    out[POSE_LAYOUT.HERO_HEADLIGHTS_ON] = NIGHT_STAGES.has(stageId) ? 1 : 0;
    const rPose = computeRiderPose(state, player, windTime, 0);
    out[POSE_LAYOUT.RIDER_PASSENGER_ARM] = rPose.waveZ;
    out[POSE_LAYOUT.RIDER_PASSENGER_HEAD_YAW] = rPose.headY;
    out[POSE_LAYOUT.RIDER_GIRL_ARM_RAISE] = rPose.girlRaise;
    out[POSE_LAYOUT.RIDER_GIRL_ARM_OUT] = rPose.girlOut;
    out[POSE_LAYOUT.RIDER_GIRL_ARM_SWING] = rPose.girlSwing;
    out[POSE_LAYOUT.RIDER_GIRL_WAVING] = rPose.greet > 0 ? 1 : 0;
    const rival = state.rival;
    const rivalKart = rival?.kartId ? state.karts?.find((k) => k.id === rival.kartId) : state.karts?.find((k) => !k.isPlayer);
    if (rival || rivalKart) {
      const rx = rivalKart?.x ?? rival?.x ?? 0;
      const rz = rivalKart?.z ?? rival?.z ?? 0;
      const rSpeed = rivalKart?.speed ?? rival?.speed ?? 0;
      const rivalZMetres = rz * METRES_PER_UNIT;
      const rivalPose = sampleRoadPose(centerline, rivalZMetres, rx);
      out[POSE_LAYOUT.RIVAL_ACTIVE] = 1;
      out[POSE_LAYOUT.RIVAL_X] = rivalPose.x;
      out[POSE_LAYOUT.RIVAL_Y] = rivalPose.y;
      out[POSE_LAYOUT.RIVAL_Z] = rivalPose.z;
      out[POSE_LAYOUT.RIVAL_YAW] = rivalPose.yaw + (rivalKart?.heading || 0) + (rivalKart?.drift ? (rivalKart.driftDir || 0) * 0.3 : 0) + (rivalKart?.spinTimer || 0) * 36 * Math.PI / 180;
      out[POSE_LAYOUT.RIVAL_PITCH] = rivalPose.pitch + (rivalKart?.body?.pitch || 0);
      out[POSE_LAYOUT.RIVAL_ROLL] = rivalKart?.body?.roll || 0;
      out[POSE_LAYOUT.RIVAL_WHEEL_SPIN] = rivalZMetres / 0.34 % (Math.PI * 2);
      out[POSE_LAYOUT.RIVAL_SPEED] = rSpeed;
      out[POSE_LAYOUT.RIVAL_BEATEN] = rival?.beaten ? 1 : rival?.escaped ? -1 : 0;
    }
    const mPose = marshalPose(state);
    const gridPose = sampleRoadPose(centerline, 4, 1.25);
    out[POSE_LAYOUT.MARSHAL_ARM] = mPose.arm;
    out[POSE_LAYOUT.MARSHAL_FLAG] = mPose.flag;
    out[POSE_LAYOUT.MARSHAL_X] = gridPose.x;
    out[POSE_LAYOUT.MARSHAL_Y] = gridPose.y;
    out[POSE_LAYOUT.MARSHAL_Z] = gridPose.z;
    out[POSE_LAYOUT.MARSHAL_YAW] = gridPose.yaw + 0.64;
    if (cut) {
      const rm = replayMoments(state, cut);
      out[POSE_LAYOUT.MOMENT_HAZE] = rm.haze;
      out[POSE_LAYOUT.MOMENT_REPLAY_ACTIVE] = 1;
      out[POSE_LAYOUT.MOMENT_REPLAY_TRIP_ALPHA] = rm.trip;
      out[POSE_LAYOUT.MOMENT_REPLAY_STAGE_ALPHA] = rm.stage?.alpha ?? 0;
    } else {
      const m = moments(state);
      out[POSE_LAYOUT.MOMENT_HAZE] = m.haze || 0;
      out[POSE_LAYOUT.MOMENT_SWOOP_STAGE] = m.swoop ? m.swoop.num : 0;
      out[POSE_LAYOUT.MOMENT_COUNTDOWN_CODE] = encodeCountdownCode(m.count);
      out[POSE_LAYOUT.MOMENT_CLEAR_STAGE] = m.clear ? m.clear.stage : 0;
      out[POSE_LAYOUT.MOMENT_CLEAR_BEATEN] = m.clear?.beaten ? 1 : 0;
      out[POSE_LAYOUT.MOMENT_CLEAR_SKIP] = m.clear?.skip ? 1 : 0;
      out[POSE_LAYOUT.MOMENT_ENDING_CLEARED] = state.stageState === "finished" ? 1 : 0;
    }
    const rawTime = state.timeRemaining ?? state.timer;
    if (typeof rawTime !== "number" || !Number.isFinite(rawTime)) {
      throw new Error("packPoseBuffer: state.timeRemaining or state.timer must be a finite number");
    }
    const timerRaw = Math.max(0, rawTime);
    const timerSec = Math.floor(timerRaw);
    const timerDec = Math.floor((timerRaw - timerSec) * 10);
    const maxRpm = 8500;
    const rpm = player.rpm ?? Math.min(maxRpm, 1200 + (player.speed || 0) * 24);
    const trackLen = Math.max(1, state.trackLength || 1);
    const forkSeg = centerline.forkStart;
    const forkZMetres = forkSeg * centerline.segLen;
    const gearNum = player.gear === "high" ? 2 : player.gear === "low" ? 1 : Number(player.gear) || 1;
    const nitroInfo = nitroStatus(player);
    const nitroVal = nitroInfo.fill * 100;
    const rivalZ = rivalKart?.z ?? rival?.z ?? 0;
    out[POSE_LAYOUT.HUD_SPEED_KMH] = Math.round(player.speed || 0);
    out[POSE_LAYOUT.HUD_RPM] = Math.round(rpm);
    out[POSE_LAYOUT.HUD_TACHO_RATIO] = Math.max(0, Math.min(1, rpm / maxRpm));
    out[POSE_LAYOUT.HUD_GEAR] = gearNum;
    out[POSE_LAYOUT.HUD_NITRO_AMOUNT] = Math.max(0, Math.min(100, nitroVal));
    out[POSE_LAYOUT.HUD_NITRO_ACTIVE] = nitroInfo.state === "boost" ? 1 : 0;
    out[POSE_LAYOUT.HUD_TIMER_SEC] = timerSec;
    out[POSE_LAYOUT.HUD_TIMER_DEC] = timerDec;
    out[POSE_LAYOUT.HUD_SCORE] = Math.floor(state.score || 0);
    out[POSE_LAYOUT.HUD_DRIFT_SCORE] = Math.floor(player.driftCharge ?? player.driftScore ?? 0);
    out[POSE_LAYOUT.HUD_GFORCE_LAT] = steerInput * ((player.speed || 0) / 120);
    out[POSE_LAYOUT.HUD_SLIPSTREAM] = (player.turboTimer || 0) > 0 || player.slipstream ? 1 : 0;
    const rivalGapUnits = rival || rivalKart ? rival?.escaped ? Math.max(0, state.trackLength - player.z) : rivalZ - player.z : 0;
    out[POSE_LAYOUT.HUD_RIVAL_GAP_METRES] = rivalGapUnits * METRES_PER_UNIT;
    out[POSE_LAYOUT.HUD_FORK_DIST_METRES] = Math.max(0, forkZMetres - heroZMetres);
    out[POSE_LAYOUT.HUD_ROUTE_PROGRESS] = Math.max(0, Math.min(1, (player.z || 0) / trackLen));
    for (let b = 0; b < EQ_BANDS; b++) {
      out[POSE_LAYOUT.HUD_EQ_0 + b] = eqLevels[b] ?? 0;
    }
    const trafficRaw = Array.isArray(state.traffic) ? state.traffic : [];
    const extraKarts = (state.karts || []).filter((k) => !k.isPlayer && k !== rivalKart).map((k, idx) => ({
      id: 100 + idx,
      colorIdx: k.character === "gnu" ? 5 : k.character === "suzanne" ? 8 : (5 + idx) % 8,
      type: "convertible",
      x: k.x || 0,
      z: k.z || 0,
      blinker: ((k.heading || 0) + (k.drift ? (k.driftDir || 0) * 0.3 : 0) + (k.spinTimer || 0) * 36 * Math.PI / 180) / 0.06,
      brake: (k.body?.pitch || 0) > 0.02,
      bodyPitch: k.body?.pitch || 0
    }));
    const taggedTraffic = trafficRaw.map((tCar, tIdx) => {
      const parsed = typeof tCar.id === "number" ? tCar.id : typeof tCar.id === "string" ? parseInt(tCar.id.replace(/\D+/g, ""), 10) : NaN;
      const colorIdx = tCar.colorIdx ?? (Number.isFinite(parsed) ? parsed : tIdx) & 7;
      return {
        ...tCar,
        colorIdx
      };
    });
    const allTraffic = [
      ...extraKarts,
      ...taggedTraffic
    ].map((tCar, idx) => {
      const tzUnits = state.trackLength ? (tCar.z || 0) % state.trackLength : tCar.z || 0;
      const tzMetres = tzUnits * METRES_PER_UNIT;
      return {
        tCar,
        idx,
        tzMetres,
        absDist: Math.abs(tzMetres - heroZMetres)
      };
    });
    allTraffic.sort((a, b) => a.absDist - b.absDist);
    let nearestDz = Infinity;
    for (const item of allTraffic) {
      const dz = item.tzMetres - heroZMetres;
      if (dz > 0 && dz < nearestDz) nearestDz = dz;
    }
    const count = Math.min(MAX_TRAFFIC_CARS, allTraffic.length);
    for (let i = 0; i < count; i++) {
      const { tCar, tzMetres } = allTraffic[i];
      const tPose = sampleRoadPose(centerline, tzMetres, tCar.x || 0);
      const base = POSE_LAYOUT.TRAFFIC_BASE + i * TRAFFIC_STRIDE;
      const typeCode = tCar.type === "convertible" ? 1 : tCar.type === "pickup" ? 2 : tCar.type === "truck" ? 3 : 0;
      const colorIdx = tCar.colorIdx ?? 0;
      const isBraking = !!(tCar.brake || tCar.braking);
      out[base + 0] = isBraking ? 2 : 1;
      out[base + 1] = tCar.modelIndex ?? typeCode + colorIdx * 8;
      out[base + 2] = tPose.x;
      out[base + 3] = tPose.y;
      out[base + 4] = tPose.z;
      out[base + 5] = tPose.yaw + (tCar.blinker ?? 0) * 0.06;
      out[base + 6] = tzMetres / 0.34 % (Math.PI * 2);
      out[base + 7] = tPose.pitch + (tCar.bodyPitch || 0);
    }
    out[POSE_LAYOUT.HUD_RADAR_NEAREST_Z] = Number.isFinite(nearestDz) ? nearestDz : -1;
    return out;
  }

  // apps/apexrun/shell/engine/native_runtime_entry.js
  var poseArray = new Float32Array(POSE_BUFFER_FLOATS);
  var currentState = apexrunEngine.initState(4919, {
    stageId: "coconut-beach",
    stageState: "title"
  });
  function decodeNativeStepInputs(maskSeat0, maskSeat1, gearMode = 0, isDuel = false) {
    const m0 = maskSeat0 | 0;
    const m1 = maskSeat1 | 0;
    const gearByte = gearMode === 2 ? 1 : gearMode === 1 ? 2 : 0;
    const cmd0 = decodeCommand(Uint8Array.of(m0 & 127, gearByte));
    if (!isDuel) {
      return cmd0;
    }
    const [s0, s1] = decodeInputs(Uint8Array.of(m0 & 63, m1 & 63), [false, false]);
    const inputs = [{ ...s0, gear: cmd0.gear }, s1];
    inputs.enter = cmd0.enter;
    return inputs;
  }
  globalThis.__apexrunPoseArray = poseArray;
  globalThis.__apexrunStageGlb = new Uint8Array(0);
  globalThis.__apexrunNative = {
    init(seed = 4919, isDuel = false, stageState = "title") {
      currentState = apexrunEngine.initState(seed >>> 0, {
        stageId: "coconut-beach",
        duel: !!isDuel,
        stageState
      });
      const view = currentState.duel ? viewForSeat(currentState, 0) : currentState;
      packPoseBuffer(view, { target: poseArray, aspect: 16 / 9 });
      return JSON.stringify({
        stageId: currentState.stageId,
        trackName: currentState.trackName,
        stageState: currentState.stageState,
        stageNum: currentState.stageNum || 1
      });
    },
    initStage(seed = 4919, stageId = "coconut-beach", stageState = "racing", playerZ = 0, playerSpeed = 0) {
      currentState = apexrunEngine.initState(seed >>> 0, {
        stageId,
        stageState,
        ...playerZ > 0 ? { playerZ } : {},
        ...playerSpeed > 0 ? { playerSpeed } : {}
      });
      const view = currentState.duel ? viewForSeat(currentState, 0) : currentState;
      packPoseBuffer(view, { target: poseArray, aspect: 16 / 9 });
      return currentState.stageId;
    },
    buildStageGlb(stageId = "coconut-beach") {
      const res = buildStageGltf(stageId, { textureSize: 8 });
      globalThis.__apexrunStageGlb = res.glb;
      return res.glb.byteLength;
    },
    step(maskSeat0, maskSeat1, gearMode, aspect, eq0, eq1, eq2, eq3, eq4, eq5) {
      const inputs = decodeNativeStepInputs(maskSeat0, maskSeat1, gearMode, !!currentState.duel);
      currentState = apexrunEngine.advanceFrame(currentState, inputs);
      const view = currentState.duel ? viewForSeat(currentState, 0) : currentState;
      packPoseBuffer(view, {
        target: poseArray,
        aspect: aspect || 16 / 9,
        eqLevels: [eq0 || 0, eq1 || 0, eq2 || 0, eq3 || 0, eq4 || 0, eq5 || 0]
      });
      const player = view.karts?.find((k) => k.isPlayer) ?? view.karts?.[0];
      const offRoad = player ? Math.abs(player.x || 0) > 1.02 : false;
      const onCurb = player ? Math.abs(player.x || 0) > 0.88 && Math.abs(player.x || 0) <= 1.05 : false;
      const events = Array.isArray(currentState.events) ? currentState.events.map((e) => e.type).join(",") : "";
      const fork = OUTRUN_STAGES[currentState.stageId]?.fork;
      const leftLabel = fork?.leftLabel ?? "DESTINATION";
      const rightLabel = fork?.rightLabel ?? "DESTINATION";
      const rival = view.karts?.find((k) => k.id === view.rival?.kartId);
      let rivalGapText = "Rival in pursuit";
      if (view.duel && player) {
        const them = view.karts.find((k) => !k.isPlayer);
        if (them) {
          const gap = them.z - player.z;
          const pace = Math.max(gap > 0 ? them.speed : player.speed, 30) * KMH_TO_UNITS_PER_TICK * 60;
          rivalGapText = `Opponent is ${(Math.abs(gap) / pace).toFixed(1)} s ${gap > 0 ? "ahead" : "behind"}`;
        }
      } else if (rival && view.rival?.beaten) {
        rivalGapText = `${rival.name} beaten`;
      } else if (rival && view.rival?.escaped) {
        rivalGapText = `${rival.name} reached the checkpoint`;
      } else if (rival && player) {
        const gap = Math.max(0, rival.z - player.z);
        const pace = Math.max(rival.speed, 30) * KMH_TO_UNITS_PER_TICK * 60;
        rivalGapText = `${rival.name} is ${(gap / pace).toFixed(1)} s ahead`;
      }
      const trkLen = view.trackLength || 5e3;
      const pz = (player?.z || 0) % trkLen;
      const ahead = (view.traffic || []).filter((t) => {
        const dz = t.z % trkLen - pz;
        return dz > 0 && dz < 450;
      });
      let radarText = "CLEAR AHEAD";
      if (ahead.length > 0) {
        const nearest = ahead.reduce((a, b) => b.z % trkLen < a.z % trkLen ? b : a);
        radarText = `${nearest.type.toUpperCase()} (${Math.round((nearest.z % trkLen - pz) * 0.1)}M)`;
      }
      return `${currentState.stageState}|${currentState.stageId}|${currentState.trackName}|${offRoad ? 1 : 0}|${onCurb ? 1 : 0}|${events}|${leftLabel}|${rightLabel}|${rivalGapText}|${radarText}`;
    }
  };
})();
