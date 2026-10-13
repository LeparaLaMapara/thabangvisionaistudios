# Replacement values, October 2026

Set on production (and the matching rows on dev) on 2026-10-13, so the
courier limit (D-37, R35,000: the Sony A7 III) and the insurance limit (D-41)
measure real values. Before this no listing had a replacement value, so the
site used each deposit as the value.

**Rule used:** the current South African price to buy the same item new,
rounded to the nearest R500. For discontinued items: the current equivalent
model, or a used price where no new equivalent fits. "Estimate" means no South
African listing was found; the owner should confirm those.

**What else this changes** (founder rules already in code, now active because
a value exists):

- Deposit = 25% of the replacement value (`RENTAL_POLICY.depositRateBps`,
  decided 2026-10-08). `deposit_amount` was set to the same 25% so Ubunye and
  the listing pages show what checkout charges.
- Trust-tier limits (`RENTAL_POLICY.trustTierLimitsCents`) now compare real
  values: R2,000 contactable, R10,000 verified, R25,000 proven, R80,000
  trusted. The A7 III (R35,000) needs a trusted renter to book online.
- Items above R50,000 (the CELTO rig) are always collected in person.

The value, the deposit before and after, and the source:

| Item | Value | Deposit before | Deposit now | Source |
|---|---:|---:|---:|---|
| CELTO 6kW Touring Rig | R100,000 | R2,250 | R25,000 | [Estimate, owner to confirm: 2x CSW218V subs, 2x CT12V tops, SQ8800 amp, processor, case, poles, cabling (EU prices on request)](https://steinigke.at/en/mpn11043698-celto-csw218v-subwoofer.html) |
| Sony Alpha A7 III | R35,000 | R2,000 | R8,750 | [Orms Direct R34,995 (body)](https://www.ormsdirect.co.za/products/sony-alpha-a7-iii-mirrorless-camera-body) |
| Workstation Laptop | R35,000 | R350 | R8,750 | Estimate, unpublished: i7 / 32GB / RTX laptop |
| Sony FE 85mm f/1.8 | R13,500 | R200 | R3,375 | [Orms Direct R13,695](https://www.ormsdirect.co.za/products/sony-fe-85mm-f1-8-lens) |
| DJI RS 5 Combo Handheld Gimbal Stabilizer | R13,000 | R3,000 | R3,250 | [Orms Direct R12,995 (combo)](https://www.ormsdirect.co.za/products/dji-rs-5-gimbal-stabilizer-combo) |
| Canon 250D | R13,000 | R250 | R3,250 | [PriceCheck R14,999 travel kit; SA guide R10,000-R13,000 with kit lens](https://www.pricecheck.co.za/offers/159508179/Canon+Eos+250D+Dslr+Essential+Travel+Camera+Kit) |
| Imix IM-715 PA Pair | R10,500 | R400 | R2,625 | [2 x Imix IM-715P active at Bounce R5,295](https://www.bounceonline.co.za/?p=399785) |
| GoPro Hero 9 Black | R9,500 | R175 | R2,375 | [Discontinued; current equivalent HERO11 Black at Orms R9,395](https://www.ormsdirect.co.za/products/gopro-hero11-black-action-camera) |
| DJI Mini 4K | R7,000 | R400 | R1,750 | [Orms Direct R7,195](https://www.ormsdirect.co.za/products/dji-mini-4k-drone) |
| Fujifilm X-T1 | R7,000 | R300 | R1,750 | [Discontinued; used body price (MPB GBP 159-364)](https://www.mpb.com/en-uk/product/fujifilm-x-t1) |
| Sony FE 50mm f/1.8 | R6,000 | R125 | R1,500 | [Orms Direct R5,795](https://www.ormsdirect.co.za/products/sony-fe-50mm-f1-8-lens) |
| Nikon D5300 | R6,000 | R250 | R1,500 | Discontinued, body only; estimate for a used body |
| Canon 75-300mm | R5,000 | R125 | R1,250 | [Orms Direct R4,895 (EF 75-300mm III)](https://www.ormsdirect.co.za/products/canon-ef-75-300mm-f-4-5-6-lens) |
| Studio Support Kit | R5,000 | R100 | R1,250 | Estimate, unpublished: heavy tripod, ND filters, adapters |
| Sigma MC-11 Mount Converter | R4,500 | R100 | R1,125 | [Orms Direct R4,295](https://www.ormsdirect.co.za/products/sigma-mc-11-mount-converter-lens-adapter-sigma-ef-mount-lenses-sony-e) |
| Beamz Party Bar 10 | R4,500 | R175 | R1,125 | [Bounce R4,315](https://www.bounceonline.co.za/?p=33620) |
| Hybrid M602UBTX 6-Channel Mixer | R3,500 | R125 | R875 | [Bounce R3,245; Fastrak R3,750](https://bounceonline.co.za/product/hybrid-m602ubtx) |
| Nikon 700mm Telephoto | R3,000 | R225 | R750 | Estimate; budget telephoto (listing gives no exact model) |
| FlashFish E200 Portable Solar Generator | R2,500 | R1,000 | R625 | [FlashFish ZA listing USD 135.99](https://www.flashfishtech.com/collections/200w-power-station) |
| DJI Mic Mini Wireless Microphone Kit | R2,000 | R1,200 | R500 | [Orms Direct R1,795 (Mic Mini 2, two-person, current model)](https://www.ormsdirect.co.za/products/dji-mic-mini-2-2-person-compact-wireless-microphone-system-for-camera-and-smartphone) |
| Triopo TR-950II Universal Speedlight | R1,500 | R400 | R375 | [Estimate from EUR 69-99 retail](https://www.fruugo.ie/triopo-tr-950-professional-on-camera-flash-light-external-speedlite-compatible-with-canon-nikon-dslr-cameras/p-421265298) |
| PRO-J Lightweight Camera Tripod / Monopod | R1,500 | R500 | R375 | [Equivalent SmallRig T-10 at Orms R1,495](https://www.ormsdirect.co.za/products/smallrig-t-10-aluminum-travel-tripod) |
| IMIX MC3001 Professional Wireless Microphone System | R1,000 | R100 | R250 | [Bounce IMC3001 R975](https://www.bounceonline.co.za/?p=399304) |
| K&F 55mm Variable ND Filter ND2–ND400 | R1,000 | R200 | R250 | Estimate, budget variable ND |
| FL-E2 Center Field Split Diopter Effects Filter 58mm | R1,000 | R200 | R250 | Estimate, budget effects filter |
| Godox Collapsible Photography Reflector | R500 | R50 | R125 | [Orms Godox 5-in-1 110cm R495](https://www.ormsdirect.co.za/products/godox-5-in-1-collapsible-reflector-110cm) |
| Baofeng UHF Radio | R500 | R50 | R125 | Estimate, UV-5R class handheld (about EUR 40) |

Not set: **Software Suite** (licences, nothing to carry or replace by courier).

Each source is also stored in `listing_private.replacement_value_evidence`.
To undo, restore the earlier deposits and set `replacement_value` back to null.
