import { EstimateResult } from '../types/estimate';

export const SAMPLE_ESTIMATES: Record<string, EstimateResult> = {
  water_damage: {
    project_meta: {
      client_name: 'Michael & Sarah Jenkins',
      claim_number: '92-8419-X21',
      carrier: 'State Farm Insurance',
      policy_number: 'HO-9481028-2',
      total_rcv: 48720.5,
      net_claim: 46220.5,
      overhead_and_profit: 4429.14,
    },
    trade_sections: [
      {
        task_id: 'T-1',
        trade_name: 'Demolition & Water Mitigation',
        category_codes_included: ['WTR', 'DMO'],
        billable_revenue: 6420.0,
        suggested_duration_days: 2,
        predecessors: '',
        scope_summary:
          'Tear out wet carpet/pad, cut 2ft drywall flood cut in living room & hallway, antimicrobial spray, containment barrier, and bagging.',
        subcontractor_name: 'Apex Mitigation & Environmental',
        subcontractor_bid: 3850.0,
      },
      {
        task_id: 'T-2',
        trade_name: 'Rough Mechanicals (MEP)',
        category_codes_included: ['ELE', 'PLM', 'HVC'],
        billable_revenue: 3850.0,
        suggested_duration_days: 2,
        predecessors: 'T-1',
        scope_summary:
          'Disconnect/reconnect water heater supply lines, reroute affected Romex branch circuits, test ductwork dampness.',
        subcontractor_name: 'Vanguard MEP Solutions',
        subcontractor_bid: 2310.0,
      },
      {
        task_id: 'T-3',
        trade_name: 'Insulation',
        category_codes_included: ['INS'],
        billable_revenue: 2140.0,
        suggested_duration_days: 1,
        predecessors: 'T-2',
        scope_summary:
          'Install R-13 fiberglass Kraft-faced batt insulation in perimeter lower exterior walls and crawlspace access cavity.',
        subcontractor_name: 'ThermalGuard Insulation',
        subcontractor_bid: 1280.0,
      },
      {
        task_id: 'T-4',
        trade_name: 'Drywall & Wall Prep',
        category_codes_included: ['DRY'],
        billable_revenue: 9680.0,
        suggested_duration_days: 5,
        predecessors: 'T-3',
        scope_summary:
          'Hang 5/8" drywall lower patching, tape, three-coat float, block sand, and match light orange peel wall texture.',
        subcontractor_name: 'Precision Drywall & Taping',
        subcontractor_bid: 5800.0,
      },
      {
        task_id: 'T-5',
        trade_name: 'Painting & Sealing',
        category_codes_included: ['PNT'],
        billable_revenue: 7240.0,
        suggested_duration_days: 3,
        predecessors: 'T-4',
        scope_summary:
          'Apply PVA latex primer sealer, two coats acrylic latex paint to living room, dining room, hallway walls and ceilings.',
        subcontractor_name: 'ProCoat Finishing',
        subcontractor_bid: 4350.0,
      },
      {
        task_id: 'T-6',
        trade_name: 'Cabinetry, Trim & Interior Doors',
        category_codes_included: ['CAB', 'FIN'],
        billable_revenue: 6120.0,
        suggested_duration_days: 3,
        predecessors: 'T-5',
        scope_summary:
          'Install 4-1/4" MDF colonial baseboards, quarter-round shoe molding, reset 3 pre-hung interior doors with new casing.',
        subcontractor_name: 'Artisan Finish Carpentry',
        subcontractor_bid: 3670.0,
      },
      {
        task_id: 'T-7',
        trade_name: 'Flooring',
        category_codes_included: ['FNH', 'FCC'],
        billable_revenue: 11850.0,
        suggested_duration_days: 3,
        predecessors: 'T-5',
        scope_summary:
          'Prep subfloor, install luxury vinyl plank (LVP) click-lock flooring in main living areas and 38oz nylon carpet in bedrooms.',
        subcontractor_name: 'Midwest Floorworks LLC',
        subcontractor_bid: 7100.0,
      },
      {
        task_id: 'T-8',
        trade_name: 'Final Cleaning & Punch List',
        category_codes_included: ['CLN'],
        billable_revenue: 1420.5,
        suggested_duration_days: 1,
        predecessors: 'T-6, T-7',
        scope_summary:
          'Post-construction detail cleaning, vacuum ducts, wipe fixtures and cabinetry, touch-up paint, owner walkthrough.',
        subcontractor_name: 'Restoration Detail Cleaners',
        subcontractor_bid: 850.0,
      },
    ],
    customer_selections: [
      {
        id: 'SEL-1',
        category: 'Flooring',
        trade: 'Flooring',
        description: 'Luxury Vinyl Plank (LVP) — click-lock, 12 mil wear layer',
        qty: 320,
        uom: 'SF',
        allowance_per_unit: 3.25,
        allowance_total: 1040.0,
        vendor: 'Wholesale Flooring Center',
        notes: 'Select color/style within allowance by week 2.',
        source: 'estimate',
      },
      {
        id: 'SEL-2',
        category: 'Paint & Finishes',
        trade: 'Painting & Sealing',
        description: 'Premium interior latex wall paint (walls & ceilings)',
        qty: 28,
        uom: 'GL',
        allowance_per_unit: 42.0,
        allowance_total: 1176.0,
        vendor: 'Sherwin-Williams',
        source: 'estimate',
      },
      {
        id: 'SEL-3',
        category: 'Trim & Doors',
        trade: 'Cabinetry, Trim & Interior Doors',
        description: '4-1/4" primed MDF baseboard with quarter-round shoe',
        qty: 210,
        uom: 'LF',
        allowance_per_unit: 2.8,
        allowance_total: 588.0,
        vendor: 'ProDesk / Carter Lumber',
        source: 'estimate',
      },
      {
        id: 'SEL-4',
        category: 'Plumbing Fixtures',
        trade: 'Rough Mechanicals (MEP)',
        description: 'Kitchen faucet — single handle pull-down',
        qty: 1,
        uom: 'EA',
        allowance_per_unit: 165.0,
        allowance_total: 165.0,
        vendor: 'Ferguson',
        source: 'estimate',
      },
    ],
    source_filename: 'StateFarm_Jenkins_Water_Estimate.pdf',
  },

  fire_rebuild: {
    project_meta: {
      client_name: 'David & Amanda Torres',
      claim_number: 'CB-2026-8812',
      carrier: 'Chubb Insurance',
      policy_number: 'CHU-77218-A',
      total_rcv: 94350.0,
      net_claim: 91850.0,
      overhead_and_profit: 8577.27,
    },
    trade_sections: [
      {
        task_id: 'T-1',
        trade_name: 'Demolition & Fire Debris',
        category_codes_included: ['DMO', 'WTR'],
        billable_revenue: 11200.0,
        suggested_duration_days: 3,
        predecessors: '',
        scope_summary:
          'Tear out charred kitchen cabinetry, burnt sheetrock, soot-damaged ceiling, remove contaminated appliances and debris haul.',
        subcontractor_name: 'Rapid Demo & Hazmat',
        subcontractor_bid: 6700.0,
      },
      {
        task_id: 'T-2',
        trade_name: 'Framing & Structural',
        category_codes_included: ['FRM'],
        billable_revenue: 8650.0,
        suggested_duration_days: 3,
        predecessors: 'T-1',
        scope_summary:
          'Sister 8 burnt 2x6 ceiling joists, rebuild kitchen partition wall framing, install structural header over island span.',
        subcontractor_name: 'Structural Framing Co.',
        subcontractor_bid: 5200.0,
      },
      {
        task_id: 'T-3',
        trade_name: 'Rough Mechanicals (MEP)',
        category_codes_included: ['ELE', 'PLM', 'HVC'],
        billable_revenue: 14800.0,
        suggested_duration_days: 4,
        predecessors: 'T-2',
        scope_summary:
          'Rewire kitchen branch circuits to AFCI breakers, run new gas range line, relocate sink rough-ins, replace charred exhaust ducting.',
        subcontractor_name: 'Tri-City Mechanical Contractors',
        subcontractor_bid: 8900.0,
      },
      {
        task_id: 'T-4',
        trade_name: 'Insulation',
        category_codes_included: ['INS'],
        billable_revenue: 3100.0,
        suggested_duration_days: 2,
        predecessors: 'T-3',
        scope_summary:
          'Install R-30 mineral wool fire-resistant batt insulation in ceiling joist bays and R-15 batt in exterior wall cavities.',
        subcontractor_name: 'EcoShield Insulation',
        subcontractor_bid: 1850.0,
      },
      {
        task_id: 'T-5',
        trade_name: 'Drywall & Wall Prep',
        category_codes_included: ['DRY'],
        billable_revenue: 16400.0,
        suggested_duration_days: 6,
        predecessors: 'T-4',
        scope_summary:
          'Hang 5/8" Type X fire-rated drywall on kitchen ceiling and walls, Level 4 finish with smooth skim coat ready for paint.',
        subcontractor_name: 'Elite Drywall Specialists',
        subcontractor_bid: 9800.0,
      },
      {
        task_id: 'T-6',
        trade_name: 'Painting & Sealing',
        category_codes_included: ['PNT'],
        billable_revenue: 12100.0,
        suggested_duration_days: 4,
        predecessors: 'T-5',
        scope_summary:
          'Apply Shellac-based smoke and odor blocker seal coat, two coats premium scrubbable kitchen enamel on walls and trim.',
        subcontractor_name: 'Pinnacle Paint Works',
        subcontractor_bid: 7250.0,
      },
      {
        task_id: 'T-7',
        trade_name: 'Cabinetry, Trim & Interior Doors',
        category_codes_included: ['CAB', 'FIN'],
        billable_revenue: 18600.0,
        suggested_duration_days: 4,
        predecessors: 'T-6',
        scope_summary:
          'Install custom maple shaker wall and base cabinets, soft-close hardware, crown molding, install quartz countertops.',
        subcontractor_name: 'Summit Custom Woodworking',
        subcontractor_bid: 11200.0,
      },
      {
        task_id: 'T-8',
        trade_name: 'Flooring',
        category_codes_included: ['FCT', 'FCH'],
        billable_revenue: 7800.0,
        suggested_duration_days: 3,
        predecessors: 'T-6',
        scope_summary:
          'Install 12x24 porcelain floor tile over Ditra uncoupling membrane, epoxy grout in kitchen, weave-in and refinish oak floor transition.',
        subcontractor_name: 'Tile Craft Innovations',
        subcontractor_bid: 4680.0,
      },
      {
        task_id: 'T-9',
        trade_name: 'Final Cleaning & Punch List',
        category_codes_included: ['CLN'],
        billable_revenue: 1700.0,
        suggested_duration_days: 2,
        predecessors: 'T-7, T-8',
        scope_summary:
          'Final ozone treatment, scrub cabinetry inside/out, polish countertops and appliances, punch-list touch-ups, PM handover.',
        subcontractor_name: 'Spotless Restoration Cleanup',
        subcontractor_bid: 1020.0,
      },
    ],
    source_filename: 'Chubb_Torres_KitchenFire_Xactimate.pdf',
  },

  storm_rebuild: {
    project_meta: {
      client_name: 'Robert Vance',
      claim_number: 'LM-550912-01',
      carrier: 'Liberty Mutual',
      policy_number: 'LMH-449102',
      total_rcv: 63980.0,
      net_claim: 61480.0,
      overhead_and_profit: 5816.36,
    },
    trade_sections: [
      {
        task_id: 'T-1',
        trade_name: 'Demolition & Tear-off',
        category_codes_included: ['DMO', 'RFG'],
        billable_revenue: 7800.0,
        suggested_duration_days: 2,
        predecessors: '',
        scope_summary:
          'Tear off 32 SQ damaged architectural shingles, remove storm-dented seamless gutters and damaged vinyl soffits.',
        subcontractor_name: 'Northstar Demolition & Demo',
        subcontractor_bid: 4680.0,
      },
      {
        task_id: 'T-2',
        trade_name: 'Roofing & Exterior Decking',
        category_codes_included: ['RFG'],
        billable_revenue: 22400.0,
        suggested_duration_days: 3,
        predecessors: 'T-1',
        scope_summary:
          'Replace 6 sheets CDX roof decking, install synthetic underlayment, ice & water shield at eaves/valleys, 30-yr Owens Corning shingles.',
        subcontractor_name: 'Apex Commercial Roofing',
        subcontractor_bid: 13440.0,
      },
      {
        task_id: 'T-3',
        trade_name: 'Siding, Gutters & Glazing',
        category_codes_included: ['SDG', 'WDW'],
        billable_revenue: 14200.0,
        suggested_duration_days: 3,
        predecessors: 'T-2',
        scope_summary:
          'Install Dutch lap vinyl siding on west gable, 6" seamless aluminum gutters, downspouts, replace 2 hail-shattered low-E sash units.',
        subcontractor_name: 'Modern Exterior Solutions',
        subcontractor_bid: 8520.0,
      },
      {
        task_id: 'T-4',
        trade_name: 'Insulation',
        category_codes_included: ['INS'],
        billable_revenue: 2880.0,
        suggested_duration_days: 1,
        predecessors: 'T-2',
        scope_summary:
          'Blow-in cellulose insulation to attic cavity R-38 level over wet storm-collapsed insulation zones.',
        subcontractor_name: 'ThermalGuard Insulation',
        subcontractor_bid: 1720.0,
      },
      {
        task_id: 'T-5',
        trade_name: 'Drywall & Wall Prep',
        category_codes_included: ['DRY'],
        billable_revenue: 9400.0,
        suggested_duration_days: 4,
        predecessors: 'T-4',
        scope_summary:
          'Replace 12 water-stained ceiling drywall sheets in master suite and dining room, tape, float, match knockdown texture.',
        subcontractor_name: 'Precision Drywall & Taping',
        subcontractor_bid: 5640.0,
      },
      {
        task_id: 'T-6',
        trade_name: 'Painting & Sealing',
        category_codes_included: ['PNT'],
        billable_revenue: 5800.0,
        suggested_duration_days: 3,
        predecessors: 'T-5',
        scope_summary:
          'Stain-kill water stains with oil-based primer, paint ceiling corner-to-corner in both rooms with flat ceiling white.',
        subcontractor_name: 'ProCoat Finishing',
        subcontractor_bid: 3480.0,
      },
      {
        task_id: 'T-7',
        trade_name: 'Final Cleaning & Punch List',
        category_codes_included: ['CLN'],
        billable_revenue: 1500.0,
        suggested_duration_days: 1,
        predecessors: 'T-3, T-6',
        scope_summary:
          'Magnetic yard sweep for roof nails, power wash driveway/patio, interior HEPA vacuuming, final homeowner inspection.',
        subcontractor_name: 'Restoration Detail Cleaners',
        subcontractor_bid: 900.0,
      },
    ],
    source_filename: 'LibertyMutual_Vance_WindHail_Estimate.pdf',
  },
};

export const RAW_ESTIMATE_SNIPPET = `INSURED: Michael & Sarah Jenkins
CLAIM NUMBER: 92-8419-X21
POLICY NUMBER: HO-9481028-2
INSURANCE CARRIER: State Farm Insurance
ESTIMATE TYPE: Water Loss Reconstruction

ROOM: LIVING ROOM
1. WTR EXT Extract water from carpet, category 1 - 240 SF
2. DMO CARP Tear out wet carpet and pad - 240 SF
3. DRY 1/2- Tear out and bag wet drywall, up to 2 ft flood cut - 48 LF
4. INS B13 Batt insulation - 3-1/2" - R-13 - Kraft faced - 96 SF
5. ELE OUT Detach & reset electrical outlets / switches - 4 EA
6. DRY 1/2+ Hang, tape, float, and finish 1/2" drywall patch - 96 SF
7. DRY TXT Texture drywall - light orange peel - 96 SF
8. PNT P Seal & prime drywall patch - 96 SF
9. PNT 2 Coat paint walls, 2 coats latex - 480 SF
10. FNH LVP Luxury vinyl plank (LVP) click-lock flooring - 240 SF
11. CAB BASE Detach & reset base cabinets, replace toe kicks - 12 LF
12. FIN B4 colonial baseboard - 4-1/4" MDF - 48 LF
13. CLN ROOM Clean room - post-construction final prep - 1 EA

ROOM: HALLWAY & BATH
14. WTR DRY Air mover & dehumidifier setup - 3 DA
15. PLM TOI Detach & reset toilet with new wax ring - 1 EA
16. DRY 5/8 Hang, tape, float 5/8" drywall in water heater closet - 64 SF
17. PNT P Seal water heater closet walls - 64 SF
18. FCT TILE Ceramic tile floor install - 45 SF
19. CLN FIN Final construction clean and punch list - 1 EA

TOTAL ESTIMATE SUMMARY:
Line Item Total: $44,291.36
Overhead (10%): $2,214.57
Profit (10%): $2,214.57
Total Replacement Cost Value (RCV): $48,720.50
Deductible: $2,500.00
Net Claim Amount: $46,220.50`;
