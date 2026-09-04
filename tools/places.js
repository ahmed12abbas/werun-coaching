/**
 * Where the club actually meets, and the pin for each one.
 *
 * One file rather than a copy in each seed: both of them write the same eight
 * places, and a link that drifts between them sends half the club to the
 * wrong gate. Keyed on the English name, which is what every schedule row
 * already carries.
 *
 * These are the coach's own pins, dropped on the meeting point rather than on
 * the park as a whole — "خط التفتيش - بعد الدوار" is one spot on Wadi Mahdia
 * Road, and a pin on the road would send a first-timer to the wrong end of it.
 *
 * Short Google links with the ?g_st= parameter the share sheet adds taken
 * off: it is analytics, all eight resolve without it, and this goes in front
 * of the whole club. https only — the Worker refuses anything else.
 */
const MAP_URL = {
  "Wadi Mahdia Road": "https://maps.app.goo.gl/fwSWCrLb9cxV7JHB6",
  "Alwaha Park": "https://maps.app.goo.gl/k28P9vwuudk2CnXC9",
  "Sports Boulevard": "https://maps.app.goo.gl/u6MqqhxKhD6Vhz5b6",
  "Misk City Track": "https://maps.app.goo.gl/MzdT2kukz4wjfysA6",
  "Alfaisal University": "https://maps.app.goo.gl/uV3WdhQKSzL3p5H88",
  "Wadi Hanifa Road-Trail": "https://maps.app.goo.gl/eDNvfRb281Uf8MTB8",
  "Alnahda Park": "https://maps.app.goo.gl/8ppM7Lp4BanDdANt6",
  "Wadi Hanifa Park": "https://maps.app.goo.gl/iKnDTQNvMCCotjhZ7",
};

/** The pin for a place, or "" for one nobody has dropped a pin on yet. */
const mapFor = (place) => MAP_URL[place] || "";

module.exports = { MAP_URL: MAP_URL, mapFor: mapFor };
