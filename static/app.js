/* koito-stats frontend. Plain JS + d3 v7. */
(() => {
  "use strict";

  const fmt = d3.format(",");
  const pct = (v, digits = 0) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (id) => document.getElementById(id);
  const ytm = (name) => `https://music.youtube.com/search?q=${encodeURIComponent(name)}`;

  let DATA = null;
  let BUCKETS = [];
  const bucketColor = (b) => {
    const i = BUCKETS.indexOf(b);
    return i < 0 || b === "Other" ? "var(--other)" : `var(--s${i + 1})`;
  };

  /* ------------------------------------------------------------ tooltip */
  const tip = $("tooltip");
  function showTip(html, ev) {
    tip.innerHTML = html;
    tip.hidden = false;
    moveTip(ev);
  }
  function moveTip(ev) {
    if (tip.hidden) return;
    let x, y;
    if (ev && ev.clientX != null) { x = ev.clientX; y = ev.clientY; }
    else if (ev && ev.target && ev.target.getBoundingClientRect) {
      const r = ev.target.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top;
    } else return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }
  function hideTip() { tip.hidden = true; }

  function seg(groupId, onChange) {
    const g = $(groupId);
    g.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      onChange(b.dataset.v);
    });
  }

  const width = (el) => Math.max(280, el.clientWidth);

  /* ------------------------------------------------------------ hero: the record */
  const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  let LEDE_INSIGHT = null;

  function renderHero(d) {
    const ov = d.overview;
    const n = ov.years.length;
    const word = WORDS[n] || String(n);
    $("headline").textContent = `${word[0].toUpperCase()}${word.slice(1)} years of listening`;
    document.title = `${n} years of listening`;
    LEDE_INSIGHT = d.insights.find((i) => i.kind === "genre") || d.insights[0] || null;
    $("lede").textContent = LEDE_INSIGHT ? LEDE_INSIGHT.text : "";

    const full = ov.years.filter((y) => !y.partial);
    const lastFull = full[full.length - 1];
    const delta = lastFull ? (ov.plays_last_365 - lastFull.plays) / lastFull.plays : null;
    const deltaText = delta == null ? "" : `${delta >= 0 ? "up" : "down"} ${pct(Math.abs(delta))} on ${lastFull.year}`;
    const stats = [
      { v: fmt(ov.plays_last_365), k: `in the last 12 months${deltaText ? `, ${deltaText}` : ""}` },
      { v: fmt(ov.artists), k: "artists" },
      { v: pct(ov.genre_coverage), k: "of plays have genre data" },
    ];
    $("stats").innerHTML = stats.map((x) => `<div><dt>${esc(x.k)}</dt><dd>${esc(x.v)}</dd></div>`).join("");
    $("hero-legend").innerHTML = BUCKETS.map((b) => `<span><i style="background:${bucketColor(b)}"></i>${esc(b)}</span>`).join("");
    const when = new Date(d.generated_at * 1000);
    const years = d.genres_by_year.rows.filter((r) => /^\d{4}$/.test(r.period));
    $("record-note").textContent = `Each groove is a year, ${years[0].period} at the label and ${years[years.length - 1].period} at the edge. ` +
      `Updated ${when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`;
    drawRecord(d);
  }

  let recordDrawn = false;
  function drawRecord(d) {
    const el = $("record");
    const years = d.genres_by_year.rows.filter((r) => /^\d{4}$/.test(r.period));
    const S = Math.min(460, Math.max(260, el.clientWidth));
    const R = S / 2, outer = R - 4, rLabel = R * 0.30, rGroove0 = rLabel + R * 0.05;
    const step = (outer - R * 0.04 - rGroove0) / years.length;
    const gap = (12 * Math.PI) / 180; // lead-in gap at 12 o'clock carries the year labels
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = !recordDrawn && !reduce;
    recordDrawn = true;

    const svg = d3.create("svg").attr("viewBox", `${-R} ${-R} ${S} ${S}`).attr("role", "img")
      .attr("aria-label", `A record whose grooves show each year's genre mix, ${years[0].period} at the centre to ${years[years.length - 1].period} at the edge. The same data is in the chart below.`);
    svg.append("circle").attr("r", outer).attr("class", "vinyl");
    // faint pressing rings between the music and the label / rim
    svg.append("circle").attr("r", outer - 2).attr("class", "vinyl-rim");

    const arc = d3.arc().cornerRadius(1.2);
    const rings = svg.append("g").attr("class", "grooves");
    years.forEach((r, i) => {
      const r0 = rGroove0 + i * step, r1 = r0 + step - Math.max(1.2, step * 0.22);
      const g = rings.append("g").attr("class", "groove").datum(r);
      let a = gap / 2;
      const span = 2 * Math.PI - gap;
      const present = BUCKETS.filter((b) => (r.shares[b] || 0) > 0);
      present.forEach((b) => {
        const v = r.shares[b] * span;
        const pad = Math.min(0.012, v / 3);
        g.append("path").attr("d", arc({ innerRadius: r0, outerRadius: r1, startAngle: a + pad, endAngle: a + v - pad }))
          .style("fill", bucketColor(b));
        a += v;
      });
      // hit area: the full ring
      g.append("path").attr("class", "groove-hit")
        .attr("d", d3.arc()({ innerRadius: r0 - 0.5, outerRadius: r0 + step + 0.5, startAngle: 0, endAngle: 2 * Math.PI }));
      if (animate) {
        g.style("opacity", 0).transition().delay(120 + i * 45).duration(420).ease(d3.easeCubicOut).style("opacity", 1);
      }
    });
    rings.selectAll(".groove")
      .on("mouseenter", function (ev, r) {
        rings.classed("dim", true); d3.select(this).classed("on", true); showTip(genreTip(r), ev);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", function () { rings.classed("dim", false); d3.select(this).classed("on", false); hideTip(); });

    // sheen: two soft wedges of reflected light
    const sheen = d3.arc().innerRadius(rLabel).outerRadius(outer - 3);
    [[-2.35, -1.75], [0.79, 1.39]].forEach(([s0, s1]) =>
      svg.append("path").attr("class", "sheen").attr("d", sheen({ startAngle: s0, endAngle: s1 })));

    // year labels in the lead-in gap, reading outward
    const lab = svg.append("g").attr("class", "groove-years");
    lab.append("text").attr("transform", `translate(0,${-(rGroove0 + step * 0.5)}) rotate(-90)`).attr("dy", "0.35em").text(years[0].period);
    lab.append("text").attr("transform", `translate(0,${-(rGroove0 + step * (years.length - 0.5))}) rotate(-90)`).attr("dy", "0.35em")
      .attr("text-anchor", "end").text(years[years.length - 1].period);

    // white label
    svg.append("circle").attr("r", rLabel).attr("class", "label-disc");
    svg.append("circle").attr("r", rLabel - 5).attr("class", "label-ring");
    svg.append("text").attr("class", "label-big").attr("y", -R * 0.07).text(fmt(d.overview.total_plays));
    svg.append("text").attr("class", "label-small").attr("y", R * 0.16).text(`plays since ${d.overview.first_play.slice(0, 4)}`);
    svg.append("circle").attr("r", Math.max(3, R * 0.022)).attr("cy", R * 0.035).attr("class", "spindle");

    el.replaceChildren(svg.node());
    if (animate) {
      svg.select(".label-disc").attr("r", 0).transition().duration(500).ease(d3.easeBackOut.overshoot(1.2)).attr("r", rLabel);
    }
  }

  /* ------------------------------------------------------------ findings: figure + micro-chart + sentence */
  const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hourShort = (h) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
  const yearsFrom = (iso) => iso.slice(0, 4);

  function figureFor(i) {
    const f = i.fig || {};
    switch (i.kind) {
      case "volume": return { big: fmt(f.value), small: "plays in the last 12 months" };
      case "genre": return { big: pct(f.to), small: `${f.bucket}, now`, dot: f.bucket };
      case "newgenres": return { big: `${f.genres.length} new`, small: f.genres.length === 1 ? "genre this year" : "genres this year" };
      case "diversity": return { big: fmt(f.value), small: `equally-played artists' worth of variety in ${f.year}` };
      case "novelty": return { big: pct(f.value), small: `of ${f.year}'s plays were new finds` };
      case "rhythm": return { big: `${DAYS_SHORT[f.day]}, ${hourShort(f.hour)}`, small: "your busiest day and hour" };
      case "obsession": return { big: f.name, small: `${fmt(f.plays)} plays in its peak run`, dot: f.bucket, name: true };
      case "comeback": return { big: `${f.gap_years} years`, small: `${f.name} was away`, dot: f.bucket };
      case "rising": return { big: f.name, small: `${fmt(f.plays)} plays in the last 90 days`, dot: f.bucket, name: true };
      default: return { big: "", small: "" };
    }
  }

  // tiny charts; every one is drawn to scale from the dashboard data
  function microFor(i, W) {
    const f = i.fig || {};
    const H = 46;
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("class", "micro").attr("aria-hidden", "true");
    const bars = (vals, hi, colorHi, labelL, labelR) => {
      const x = d3.scaleBand().domain(d3.range(vals.length)).range([0, W]).paddingInner(0.25);
      const y = d3.scaleLinear().domain([0, d3.max(vals) || 1]).range([H - 14, 2]);
      svg.selectAll("rect.b").data(vals).join("rect").attr("class", "b")
        .attr("x", (_, k) => x(k)).attr("width", x.bandwidth()).attr("y", (v) => y(v)).attr("height", (v) => y(0) - y(v)).attr("rx", Math.min(2, x.bandwidth() / 2))
        .style("fill", (_, k) => (k === hi ? colorHi : "var(--mark-soft)"));
      svg.append("text").attr("class", "micro-l").attr("x", 0).attr("y", H - 1).text(labelL);
      svg.append("text").attr("class", "micro-l").attr("x", W).attr("y", H - 1).attr("text-anchor", "end").text(labelR);
    };
    const meters = (rows, max) => {
      // rows: [{label, v, color, soft}]
      const x = d3.scaleLinear().domain([0, max]).range([0, W]);
      rows.forEach((r, k) => {
        const y = k * 23;
        svg.append("rect").attr("x", 0).attr("y", y + 12).attr("width", W).attr("height", 7).attr("rx", 3.5).style("fill", "var(--wash)");
        svg.append("rect").attr("x", 0).attr("y", y + 12).attr("width", Math.max(3, x(r.v))).attr("height", 7).attr("rx", 3.5)
          .style("fill", r.color).style("opacity", r.soft ? 0.45 : 1);
        svg.append("text").attr("class", "micro-l").attr("x", 0).attr("y", y + 9).text(r.label);
        svg.append("text").attr("class", "micro-l v").attr("x", W).attr("y", y + 9).attr("text-anchor", "end").text(r.text);
      });
    };
    const line = (vals, hi, labelL, labelR, band) => {
      const pts = vals.map((v, k) => [k, v]).filter((p) => p[1] != null);
      const x = d3.scaleLinear().domain([0, vals.length - 1]).range([4, W - 4]);
      const y = d3.scaleLinear().domain([0, d3.max(pts, (p) => p[1]) || 1]).range([H - 15, 4]);
      if (band) svg.append("rect").attr("x", x(band[0]) - 3).attr("y", 0).attr("width", Math.max(6, x(band[1]) - x(band[0]) + 6)).attr("height", H - 13).attr("rx", 3).style("fill", "var(--wash)");
      svg.append("path").attr("d", d3.line().x((p) => x(p[0])).y((p) => y(p[1])).curve(d3.curveMonotoneX)(pts))
        .style("fill", "none").style("stroke", "var(--mark-soft)").style("stroke-width", 1.75).style("stroke-linejoin", "round");
      if (hi != null && vals[hi] != null) svg.append("circle").attr("cx", x(hi)).attr("cy", y(vals[hi])).attr("r", 4).style("fill", "var(--ink)").style("stroke", "var(--page)").style("stroke-width", 2);
      svg.append("text").attr("class", "micro-l").attr("x", 0).attr("y", H - 1).text(labelL);
      svg.append("text").attr("class", "micro-l").attr("x", W).attr("y", H - 1).attr("text-anchor", "end").text(labelR);
    };
    const yrs = DATA.overview.years;
    switch (i.kind) {
      case "volume": {
        const vals = [...yrs.filter((y) => !y.partial).map((y) => y.plays), f.value];
        bars(vals, vals.length - 1, "var(--ink)", String(yrs[0].year), "last 12 months");
        break;
      }
      case "genre":
        meters([{ label: f.span, v: f.from, text: pct(f.from), color: bucketColor(f.bucket), soft: true },
                { label: "Last 12 months", v: f.to, text: pct(f.to), color: bucketColor(f.bucket) }], Math.max(f.from, f.to) * 1.15);
        break;
      case "newgenres":
        meters(f.genres.slice(0, 2).map((g) => ({ label: g.genre, v: g.share, text: pct(g.share, 1), color: bucketColor(g.bucket || "Other") })),
          d3.max(f.genres, (g) => g.share) * 1.4);
        break;
      case "novelty": {
        const nd = DATA.novelty_diversity;
        line(nd.map((r) => r.new_share), nd.findIndex((r) => r.year === f.year), String(nd[0].year), String(nd[nd.length - 1].year));
        break;
      }
      case "diversity": {
        const nd = DATA.novelty_diversity;
        line(nd.map((r) => r.effective_artists), nd.findIndex((r) => r.year === f.year), String(nd[0].year), String(nd[nd.length - 1].year));
        break;
      }
      case "rhythm":
        bars(f.hours, f.hour, "var(--ink)", "midnight", "11pm");
        break;
      case "obsession": {
        const o = DATA.obsessions.find((x) => x.id === f.id) || DATA.obsessions[0];
        const idx = (mm) => { const [y0, m0] = o.spark.start.split("-").map(Number); const [y1, m1] = mm.split("-").map(Number); return (y1 - y0) * 12 + (m1 - m0); };
        line(o.spark.values, null, monthName(o.spark.start), "now", [idx(o.start), idx(o.end)]);
        const x = d3.scaleLinear().domain([0, o.spark.values.length - 1]).range([4, W - 4]);
        const y = d3.scaleLinear().domain([0, d3.max(o.spark.values) || 1]).range([H - 15, 4]);
        const pk = o.spark.values.indexOf(d3.max(o.spark.values.slice(idx(o.start), idx(o.end) + 1)), idx(o.start));
        svg.append("circle").attr("cx", x(pk)).attr("cy", y(o.spark.values[pk])).attr("r", 4).style("fill", bucketColor(f.bucket || "Other")).style("stroke", "var(--page)").style("stroke-width", 2);
        break;
      }
      case "comeback": {
        const t0 = new Date(f.last_before), t1 = new Date(f.returned), now = new Date();
        const start = new Date(t0.getFullYear() - 1, 0, 1);
        const x = d3.scaleTime().domain([start, now]).range([6, W - 6]);
        const yy = 16;
        svg.append("line").attr("x1", x(start)).attr("x2", x(t0)).attr("y1", yy).attr("y2", yy).style("stroke", bucketColor(f.bucket || "Other")).style("stroke-width", 3).style("stroke-linecap", "round").style("opacity", 0.5);
        svg.append("line").attr("x1", x(t0)).attr("x2", x(t1)).attr("y1", yy).attr("y2", yy).style("stroke", "var(--line)").style("stroke-width", 1);
        svg.append("line").attr("x1", x(t1)).attr("x2", x(now)).attr("y1", yy).attr("y2", yy).style("stroke", bucketColor(f.bucket || "Other")).style("stroke-width", 3).style("stroke-linecap", "round");
        svg.append("circle").attr("cx", x(t0)).attr("cy", yy).attr("r", 4.5).style("fill", "var(--page)").style("stroke", bucketColor(f.bucket || "Other")).style("stroke-width", 2);
        svg.append("circle").attr("cx", x(t1)).attr("cy", yy).attr("r", 4.5).style("fill", bucketColor(f.bucket || "Other")).style("stroke", "var(--page)").style("stroke-width", 2);
        svg.append("text").attr("class", "micro-l").attr("x", x(t0)).attr("y", H - 1).attr("text-anchor", "middle").text(`left ${yearsFrom(f.last_before)}`);
        svg.append("text").attr("class", "micro-l").attr("x", Math.min(x(t1), W - 28)).attr("y", H - 1).attr("text-anchor", "middle").text(`back ${yearsFrom(f.returned)}`);
        break;
      }
      case "rising":
        meters([{ label: "Year before", v: f.from, text: pct(f.from, 1), color: bucketColor(f.bucket || "Other"), soft: true },
                { label: "Last 90 days", v: f.to, text: pct(f.to, 1), color: bucketColor(f.bucket || "Other") }], Math.max(f.from, f.to) * 1.15);
        break;
      default: return null;
    }
    return svg.node();
  }

  function renderInsights(list) {
    const items = list.filter((i) => i !== LEDE_INSIGHT);
    const host = $("insights");
    // three columns: widen the first (and if needed the last) finding so no row ends half empty
    const cols = window.innerWidth > 980 ? 3 : window.innerWidth > 620 ? 2 : 1;
    const spare = (cols - (items.length % cols)) % cols;
    host.innerHTML = items.map((i, k) => {
      const fg = figureFor(i);
      const wide = cols > 1 && ((spare >= 1 && k === 0) || (spare >= 2 && k === items.length - 1));
      const clickable = fg.name && i.fig && i.fig.id != null;
      const big = clickable ? `<button class="f-big f-name" data-explore-id="${i.fig.id}">${esc(fg.big)}</button>` : `<span class="f-big${fg.name ? " f-name" : ""}">${esc(fg.big)}</span>`;
      return `<li class="finding${wide ? " wide" : ""}">
        <div class="f-fig">${big}<span class="f-small">${fg.dot ? `<i class="gdot" style="background:${bucketColor(fg.dot)}"></i>` : ""}${esc(fg.small)}</span></div>
        <div class="f-micro"></div>
        <p class="f-text">${esc(i.text)}</p>
      </li>`;
    }).join("");
    host.querySelectorAll(".f-micro").forEach((el, k) => {
      const node = microFor(items[k], Math.max(160, el.clientWidth));
      if (node) el.replaceChildren(node); else el.remove();
    });
  }

  /* ------------------------------------------------------------ genres by year (100% stacked area) */
  function roundedTop(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    if (h <= 0) return "";
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function renderGenreChart() {
    const g = DATA.genres_by_year;
    const all = g.rows;
    const rows = all.filter((r) => /^\d{4}$/.test(r.period)).map((r) => ({ ...r, year: +r.period }));
    $("genre-legend").innerHTML = BUCKETS.map((b) => `<span><i style="background:${bucketColor(b)}"></i>${esc(b)}</span>`).join("");

    const el = $("genre-chart");
    const W = width(el), wide = W >= 640;
    const H = wide ? 380 : 300, m = { t: 6, r: wide ? 236 : 6, b: 28, l: 38 };
    const x = d3.scaleLinear().domain(d3.extent(rows, (r) => r.year)).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([0, 1]).range([H - m.b, m.t]);
    // normalise each year over the buckets present, so the stack always fills 0..1
    const norm = rows.map((r) => {
      const tot = d3.sum(BUCKETS, (b) => r.shares[b] || 0) || 1;
      return Object.fromEntries([["year", r.year], ...BUCKETS.map((b) => [b, (r.shares[b] || 0) / tot])]);
    });
    const series = d3.stack().keys(BUCKETS)(norm);
    const area = d3.area().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);

    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
      .attr("aria-label", "Stacked area: share of plays by genre group for each year. The same data is in the table below.");
    svg.append("g").selectAll("path").data(series).join("path")
      .attr("d", area).attr("class", "band")
      .style("fill", (sr) => bucketColor(sr.key))
      .style("stroke", "var(--page)").style("stroke-width", 1.5);
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).tickValues([0, 0.5, 1]).tickFormat(d3.format(".0%")).tickSize(0).tickPadding(8))
      .call((sel) => sel.select(".domain").remove());
    const years = rows.map((r) => r.year);
    const every = Math.ceil(years.length / Math.max(2, Math.floor((W - m.l - m.r) / 52)));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(years.filter((_, i) => (years.length - 1 - i) % every === 0)).tickFormat(d3.format("d")).tickSize(0).tickPadding(10))
      .call((sel) => sel.select(".domain").remove());

    // direct labels at the right edge for bands thick enough to name
    if (wide) {
      const last = series.map((sr) => ({ key: sr.key, v: sr[sr.length - 1][1] - sr[sr.length - 1][0], mid: y((sr[sr.length - 1][0] + sr[sr.length - 1][1]) / 2) }))
        .filter((d) => d.v >= 0.035);
      // relax overlaps: keep labels at least 17px apart
      last.sort((a, b2) => a.mid - b2.mid);
      for (let k = 0; k < 4; k++) for (let i = 1; i < last.length; i++) if (last[i].mid - last[i - 1].mid < 17) last[i].mid = last[i - 1].mid + 17;
      const lg = svg.append("g").attr("class", "direct-labels");
      last.forEach((d) => {
        lg.append("circle").attr("cx", W - m.r + 14).attr("cy", d.mid).attr("r", 4).style("fill", bucketColor(d.key));
        lg.append("text").attr("x", W - m.r + 24).attr("y", d.mid).attr("dy", "0.35em").text(d.key);
        lg.append("text").attr("class", "v").attr("x", W - 2).attr("y", d.mid).attr("dy", "0.35em").attr("text-anchor", "end").text(pct(d.v));
      });
    }

    // crosshair + tooltip, snapping to the nearest year
    const cross = svg.append("line").attr("class", "crosshair").attr("y1", m.t).attr("y2", H - m.b).style("opacity", 0);
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
      .on("mousemove", (ev) => {
        const [mx] = d3.pointer(ev);
        const r = rows.reduce((a, b2) => (Math.abs(x(b2.year) - mx) < Math.abs(x(a.year) - mx) ? b2 : a), rows[0]);
        cross.attr("x1", x(r.year)).attr("x2", x(r.year)).style("opacity", 1);
        showTip(genreTip(r), ev);
      })
      .on("mouseleave", () => { cross.style("opacity", 0); hideTip(); });

    el.replaceChildren(svg.node());

    const minCov = d3.min(all, (r) => r.coverage);
    $("genre-coverage").textContent = `Genre data covers ${pct(DATA.overview.genre_coverage)} of plays overall (lowest year: ${pct(minCov)}). Plays by artists without genre data are left out of the shares.`;

    $("genre-table").innerHTML = `<div class="tbl-wrap"><table class="data"><thead><tr><th>Period</th>${BUCKETS.map((b) => `<th>${esc(b)}</th>`).join("")}<th>Plays</th><th>Coverage</th></tr></thead><tbody>${
      all.map((r) => `<tr><td>${esc(r.period)}</td>${BUCKETS.map((b) => `<td>${pct(r.shares[b] || 0, 1)}</td>`).join("")}<td>${fmt(r.plays)}</td><td>${pct(r.coverage)}</td></tr>`).join("")
    }</tbody></table></div>`;
  }

  function genreTip(r) {
    const partial = DATA.overview.years.find((y) => String(y.year) === r.period && y.partial);
    const items = BUCKETS.slice().reverse().filter((b) => (r.shares[b] || 0) >= 0.0005);
    return `<div class="t">${esc(r.period)}${partial ? " (so far)" : ""}</div>` +
      items.map((b) => `<div class="r"><span><i style="background:${bucketColor(b)}"></i>${esc(b)}</span><span>${pct(r.shares[b], 1)}</span></div>`).join("") +
      `<div class="m" style="margin-top:4px">${fmt(r.plays)} plays, genres known for ${pct(r.coverage)}</div>`;
  }

  /* ------------------------------------------------------------ genre movers (diverging bars of relative change) */
  function renderMovers() {
    const mv = DATA.genre_movers;
    const rows = [...mv.rising, ...mv.falling.slice().reverse()];
    if (!rows.length) { $("movers-card").hidden = true; return; }
    const max = d3.max(rows, (r) => Math.abs(r.change)) || 1;
    const pctChange = (c) => `${c >= 0 ? "+" : "−"}${Math.round(Math.abs(c) * 100)}%`;
    const share = (v) => `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%`;
    $("movers").innerHTML = rows.map((r, i) => {
      const w = (Math.abs(r.change) / max) * 50;
      const up = r.change >= 0;
      const gapBefore = i === mv.rising.length && i > 0 ? " split" : "";
      return `<div class="mv${up ? " up" : " down"}${gapBefore}" role="listitem" tabindex="0" style="--f:${(w / 50).toFixed(4)};--c:${bucketColor(r.bucket || "Other")}"
          aria-label="${esc(`${r.genre}: ${pctChange(r.change)}, from ${share(r.before)} to ${share(r.recent)} of plays`)}">
        <span class="mv-name">${esc(r.genre)}</span>
        <span class="mv-bar"></span>
        <span class="mv-val"><b>${pctChange(r.change)}</b> <span>${share(r.before)} → ${share(r.recent)}</span></span>
      </div>`;
    }).join("");
    document.querySelectorAll("#movers .mv").forEach((el, i) => {
      const r = rows[i];
      const tipHtml = `<div class="t">${esc(r.genre)}</div><div class="r"><span>3 years before</span><span>${share(r.before)}</span></div><div class="r"><span>Last 12 months</span><span>${share(r.recent)}</span></div><div class="m">${pctChange(r.change)} relative, ${r.delta >= 0 ? "+" : "−"}${Math.abs(r.delta * 100).toFixed(2)} points. ${esc(r.bucket || "")}</div>`;
      el.addEventListener("mouseenter", (ev) => showTip(tipHtml, ev));
      el.addEventListener("focus", (ev) => showTip(tipHtml, ev));
      el.addEventListener("mousemove", moveTip);
      el.addEventListener("mouseleave", hideTip);
      el.addEventListener("blur", hideTip);
    });
    $("movers-new").innerHTML = mv.new.length
      ? `<p class="newgenres">New territory, barely played before this year: ${mv.new.map((g) => `<span class="pill">${esc(g.genre)} ${share(g.recent)}</span>`).join("")}</p>` : "";
  }

  /* ------------------------------------------------------------ small multiples over years */
  function smallMultiple(elId, data, { kind, value, format, label }) {
    const el = $(elId);
    const W = width(el), H = 170, m = { t: 14, r: 12, b: 22, l: 40 };
    const pts = data.filter((d) => value(d) != null);
    const x = kind === "col"
      ? d3.scaleBand().domain(data.map((d) => d.year)).range([m.l, W - m.r]).padding(0.3)
      : d3.scalePoint().domain(data.map((d) => d.year)).range([m.l, W - m.r]).padding(0.3);
    const cx = (d) => (kind === "col" ? x(d.year) + x.bandwidth() / 2 : x(d.year));
    const y = d3.scaleLinear().domain([0, d3.max(pts, value) * 1.1 || 1]).nice(4).range([H - m.b, m.t]);
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", label);
    svg.append("g").selectAll("line").data(y.ticks(4).filter((t) => t > 0)).join("line").attr("class", "gridline")
      .attr("x1", m.l).attr("x2", W - m.r).attr("y1", y).attr("y2", y);
    svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickFormat(format.axis).tickSize(0).tickPadding(6)).call((s) => s.select(".domain").remove());
    const years = data.map((d) => d.year);
    const every = Math.ceil(years.length / Math.max(2, Math.floor((W - m.l) / 46)));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
      .call(d3.axisBottom(x).tickValues(years.filter((_, i) => (years.length - 1 - i) % every === 0)).tickFormat((v) => `'${String(v).slice(2)}`).tickSize(0).tickPadding(7))
      .call((s) => s.select(".domain").remove());

    if (kind === "col") {
      const bw = Math.min(24, x.bandwidth());
      svg.append("g").selectAll("path").data(pts).join("path")
        .attr("d", (d) => roundedTop(cx(d) - bw / 2, y(value(d)), bw, y(0) - y(value(d)), 4))
        .style("fill", (d) => (d.partial ? "var(--mark-soft)" : "var(--mark)"));
      const maxD = pts.reduce((a, b) => (value(b) > value(a) ? b : a), pts[0]);
      const lastD = pts[pts.length - 1];
      [maxD, lastD].filter((d, i, a) => a.indexOf(d) === i).forEach((d) => {
        svg.append("text").attr("x", cx(d)).attr("y", y(value(d)) - 4).attr("text-anchor", "middle")
          .style("fill", "var(--ink-2)").style("font-size", "11px").text(format.label(value(d)) + (d.partial ? "*" : ""));
      });
    } else {
      svg.append("path").datum(pts).attr("d", d3.line().x(cx).y((d) => y(value(d))).curve(d3.curveMonotoneX))
        .style("fill", "none").style("stroke", "var(--mark)").style("stroke-width", 2).style("stroke-linejoin", "round").style("stroke-linecap", "round");
      const last = pts[pts.length - 1];
      svg.append("circle").attr("cx", cx(last)).attr("cy", y(value(last))).attr("r", 4.5)
        .style("fill", "var(--mark)").style("stroke", "var(--page)").style("stroke-width", 2);
      svg.append("text").attr("x", cx(last)).attr("y", y(value(last)) - 9).attr("text-anchor", "end")
        .style("fill", "var(--ink-2)").style("font-size", "11px").text(format.label(value(last)));
    }
    svg.append("line").attr("class", "baseline").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(0)).attr("y2", y(0));

    // crosshair + tooltip
    const cross = svg.append("line").attr("class", "crosshair").attr("y1", m.t).attr("y2", H - m.b).style("opacity", 0);
    const focus = svg.append("circle").attr("r", 4.5).style("fill", "var(--mark)").style("stroke", "var(--page)").style("stroke-width", 2).style("opacity", 0);
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b).attr("fill", "transparent")
      .on("mousemove", (ev) => {
        const [mx] = d3.pointer(ev);
        const d = pts.reduce((a, b) => (Math.abs(cx(b) - mx) < Math.abs(cx(a) - mx) ? b : a), pts[0]);
        cross.attr("x1", cx(d)).attr("x2", cx(d)).style("opacity", 1);
        if (kind !== "col") focus.attr("cx", cx(d)).attr("cy", y(value(d))).style("opacity", 1);
        showTip(`<div class="t">${d.year}${d.partial ? " (so far)" : ""}</div><div class="r"><span>${esc(label)}</span><span>${format.tip(value(d))}</span></div>`, ev);
      })
      .on("mouseleave", () => { cross.style("opacity", 0); focus.style("opacity", 0); hideTip(); });
    el.replaceChildren(svg.node());
  }

  function renderOverTime() {
    const years = DATA.overview.years;
    const nd = DATA.novelty_diversity.map((r) => ({ ...r, partial: years.find((y) => y.year === r.year)?.partial }));
    const compact = d3.format("~s");
    smallMultiple("sm-plays", years, { kind: "col", value: (d) => d.plays, label: "Plays",
      format: { axis: (v) => (v >= 10000 ? compact(v).replace("k", "K") : fmt(v)), label: (v) => (v >= 10000 ? `${(v / 1000).toFixed(1)}K` : fmt(v)), tip: fmt } });
    smallMultiple("sm-new", nd, { kind: "line", value: (d) => d.new_share, label: "From artists new to you",
      format: { axis: d3.format(".0%"), label: (v) => pct(v), tip: (v) => pct(v, 1) } });
    smallMultiple("sm-div", nd, { kind: "line", value: (d) => d.effective_artists, label: "Equivalent equally-played artists",
      format: { axis: (v) => fmt(v), label: (v) => fmt(Math.round(v)), tip: (v) => fmt(Math.round(v)) } });
  }

  /* ------------------------------------------------------------ heatmap */
  let heatMode = "last12";
  function renderHeatmap() {
    const grid = DATA.heatmap[heatMode];
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const el = $("heatmap");
    const W = width(el), m = { t: 6, r: 4, b: 30, l: 40 };
    const cw = (W - m.l - m.r) / 24, ch = Math.max(22, Math.min(40, cw));
    const H = m.t + ch * 7 + m.b;
    const max = d3.max(grid.flat()) || 1;
    const rMax = Math.min(cw, ch) / 2 - 1.5;
    const r = d3.scaleSqrt().domain([0, max]).range([0, rMax]); // area = plays
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", "Punch card of plays by weekday and hour; dot area is the number of plays");
    // faint row guides
    svg.append("g").selectAll("line").data(days).join("line").attr("class", "gridline")
      .attr("x1", m.l).attr("x2", W - m.r).attr("y1", (_, i) => m.t + i * ch + ch / 2).attr("y2", (_, i) => m.t + i * ch + ch / 2);
    const cells = [];
    grid.forEach((row, d) => row.forEach((v, h) => cells.push({ d, h, v })));
    const peak = cells.reduce((a, b) => (b.v > a.v ? b : a), cells[0]);
    const g = svg.append("g").selectAll("g").data(cells).join("g")
      .attr("transform", (c) => `translate(${m.l + c.h * cw + cw / 2},${m.t + c.d * ch + ch / 2})`);
    g.append("circle").attr("r", (c) => (c.v ? Math.max(1.2, r(c.v)) : 0))
      .attr("class", (c) => (c === peak ? "punch peak" : "punch"));
    g.append("rect").attr("x", -cw / 2).attr("y", -ch / 2).attr("width", cw).attr("height", ch).attr("fill", "transparent")
      .on("mouseenter", (ev, c) => showTip(`<div class="t">${days[c.d]} ${hourLabel(c.h)}–${hourLabel((c.h + 1) % 24)}</div><div class="r"><span>Plays</span><span>${fmt(c.v)}</span></div>`, ev))
      .on("mousemove", moveTip).on("mouseleave", hideTip);
    svg.append("g").selectAll("text").data(days).join("text").attr("x", m.l - 10).attr("y", (_, i) => m.t + i * ch + ch / 2).attr("dy", "0.35em")
      .attr("text-anchor", "end").attr("class", "tick-label").text((d) => d);
    const step = cw < 22 ? 6 : 3;
    svg.append("g").selectAll("text").data(d3.range(0, 24, step)).join("text")
      .attr("x", (h) => m.l + h * cw + cw / 2).attr("y", m.t + 7 * ch + 18).attr("text-anchor", "middle")
      .attr("class", "tick-label").text(hourLabel);
    el.replaceChildren(svg.node());
    $("heat-sub").textContent = `Plays by weekday and hour, in ${DATA.heatmap.tz.replace("_", " ")} time. Bigger dot, more plays; the busiest hour is ${days[peak.d]} ${hourLabel(peak.h)} with ${fmt(peak.v)} plays.`;
  }
  const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

  /* ------------------------------------------------------------ lists */
  function sparkSvg(spark, start, end) {
    const vals = spark.values;
    const W = 120, H = 34;
    const x = d3.scaleLinear().domain([0, vals.length - 1]).range([2, W - 2]);
    const y = d3.scaleLinear().domain([0, d3.max(vals) || 1]).range([H - 2, 3]);
    const idx = (mm) => {
      const [y0, m0] = spark.start.split("-").map(Number);
      const [y1, m1] = mm.split("-").map(Number);
      return (y1 - y0) * 12 + (m1 - m0);
    };
    const s = idx(start), e = idx(end);
    const line = d3.line().x((_, i) => x(i)).y((v) => y(v)).curve(d3.curveMonotoneX)(vals);
    const area = d3.area().x((_, i) => x(i)).y0(H - 2).y1((v) => y(v)).curve(d3.curveMonotoneX)(vals);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <rect x="${x(s) - 3}" y="0" width="${Math.max(6, x(e) - x(s) + 6)}" height="${H}" rx="3" style="fill:var(--wash)"/>
      <path d="${line}" style="fill:none;stroke:var(--mark);stroke-width:1.5;stroke-linejoin:round"/>
    </svg>`;
  }

  const artistBtn = (a) => `<i class="gdot" style="background:${bucketColor(a.bucket || "Other")}" title="${esc(a.bucket || "Genre unknown")}"></i><button data-explore-id="${a.id}">${esc(a.name)}</button>`;
  const monthName = (mm) => { const [y, m] = mm.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" }); };

  function renderLists() {
    const obs = DATA.obsessions.slice(0, 12);
    $("obsessions").innerHTML = obs.length ? obs.map((o) => {
      const span = o.start === o.end ? monthName(o.start) : `${monthName(o.start)} – ${monthName(o.end)}`;
      let after = "";
      if (o.after_monthly == null) after = `<span class="badge">recent</span>`;
      else after = o.after_monthly >= o.during_monthly * 0.35 ? `<span class="badge">stuck around</span>` : `<span class="badge">faded</span>`;
      return `<li><span class="who">${artistBtn(o)}${after}</span>
        <span class="detail">${span}, ${fmt(o.plays)} plays, peaking at ${pct(o.peak_share)} of the month</span>
        ${sparkSvg(o.spark, o.start, o.end)}</li>`;
    }).join("") : `<li><span class="detail">No obsessions yet by this definition.</span></li>`;

    $("comebacks").innerHTML = DATA.comebacks.slice(0, 8).map((c) => `<li>
        <span class="who">${artistBtn(c)}</span>
        <span class="detail">Away ${c.gap_years} years, then ${c.plays_first_90d} plays in the first 90 days back</span>
        <span class="num">${new Date(c.returned).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span></li>`).join("")
      || `<li><span class="detail">None yet.</span></li>`;

    $("rising").innerHTML = DATA.rising.slice(0, 6).map((r) => `<li>
        <span class="who">${artistBtn(r)}</span>
        <span class="detail">${pct(r.prior_share, 1)} → ${pct(r.recent_share, 1)} of your plays</span>
        <span class="num">${r.recent_plays} plays</span></li>`).join("")
      || `<li><span class="detail">Nothing climbing right now.</span></li>`;
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-explore-id]");
    if (b) {
      const id = Number(b.dataset.exploreId);
      explore({ id }, null, { reset: true, scroll: true });
    }
    const r = e.target.closest("[data-explore-mbid]");
    if (r) explore({ mbid: r.dataset.exploreMbid, name: r.dataset.name }, null, { reset: true, scroll: true });
  });

  /* ------------------------------------------------------------ recommendations */
  let recsShown = 12;
  function renderRecs() {
    const recs = DATA.recommendations;
    if (!recs.length) {
      $("recs").innerHTML = `<p class="sub">Recommendations appear once similar-artist data has been fetched for your top artists.</p>`;
      return;
    }
    const list = (names) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    $("recs").innerHTML = recs.slice(0, recsShown).map((r) => `
      <div class="rec">
        <div class="name"><i aria-hidden="true" style="--c:${bucketColor(r.bucket || "Other")}"></i>${esc(r.name)}</div>
        ${r.genres.length ? `<div class="genres">${esc(r.genres.join(", "))}</div>` : ""}
        <div class="why">Because you play ${esc(list(r.because.map((b) => b.name)))}${r.seed_count > 3 ? `, plus ${r.seed_count - 3} more of your artists` : ""}.</div>
        <div class="acts">
          <button class="link-btn" data-explore-mbid="${esc(r.mbid)}" data-name="${esc(r.name)}">Explore</button>
          <a class="link-btn" href="${ytm(r.name)}" target="_blank" rel="noopener">YouTube Music ↗</a>
        </div>
      </div>`).join("");
    $("recs-more").hidden = recsShown >= recs.length;
  }
  $("recs-more").addEventListener("click", () => { recsShown += 12; renderRecs(); });

  /* ------------------------------------------------------------ artist explorer */
  const EX = {
    sizeBy: "plays",
    trail: [],          // [{q, name}]
    data: null,
    pos: new Map(),     // node key -> {x, y}
    sim: null,
    svg: null,
  };
  const nodeKey = (n) => n.mbid || `id:${n.id}`;

  seg("size-toggle", (v) => { EX.sizeBy = v; if (EX.data) drawBubbles(null, true); });

  async function explore(q, origin, { reset = false, scroll = false, fromTrail = -1 } = {}) {
    const params = new URLSearchParams();
    if (q.id != null) params.set("id", q.id);
    if (q.mbid) params.set("mbid", q.mbid);
    if (q.name) params.set("name", q.name);
    $("bubbles").style.opacity = EX.data ? 0.7 : 1;
    if (scroll) $("explore-card").scrollIntoView({ behavior: "smooth", block: "start" });
    let d;
    try {
      const res = await fetch(`api/explore?${params}`);
      if (!res.ok) throw new Error(await res.text());
      d = await res.json();
    } catch (err) {
      $("bubbles").style.opacity = 1;
      $("panel").innerHTML = `<p class="note">Couldn't load that artist (${esc(err.message.slice(0, 120))}).</p>`;
      return;
    }
    $("bubbles").style.opacity = 1;
    if (reset) EX.trail = [];
    if (fromTrail >= 0) EX.trail = EX.trail.slice(0, fromTrail);
    EX.trail.push({ q: d.center.id != null ? { id: d.center.id } : { mbid: d.center.mbid, name: d.center.name }, name: d.center.name });
    if (EX.trail.length > 10) EX.trail = EX.trail.slice(-10);
    EX.data = d;
    renderTrail();
    renderPanel(d);
    drawBubbles(origin);
  }

  function renderTrail() {
    $("trail").innerHTML = EX.trail.map((t, i) => i === EX.trail.length - 1
      ? `<span class="cur">${esc(t.name)}</span>`
      : `<button data-trail="${i}">${esc(t.name)}</button><span aria-hidden="true">→</span>`).join(" ");
  }
  $("trail").addEventListener("click", (e) => {
    const b = e.target.closest("[data-trail]");
    if (!b) return;
    const i = Number(b.dataset.trail);
    explore(EX.trail[i].q, null, { fromTrail: i });
  });

  function maxPlays() {
    const list = EX.sizeBy === "plays" ? DATA.top_all : DATA.top_12m;
    return list.length ? list[0].plays : 1;
  }

  function drawBubbles(origin, resizeOnly = false) {
    const host = $("bubbles");
    $("bubble-empty").hidden = true;
    const W = host.clientWidth, H = host.clientHeight || 540;
    const cx = W / 2, cy = H / 2 - 10;
    const minDim = Math.min(W, H);
    const narrow = W < 560;
    const rMax = Math.max(16, Math.min(62, minDim / 8.5));
    const r = d3.scaleSqrt().domain([0, maxPlays()]).range([0, rMax]).clamp(true);
    const d = { ...EX.data, similar: EX.data.similar.slice(0, narrow ? 12 : 18) };
    const n = d.similar.length;
    const radiusOf = (node, isCenter) => {
      const v = node[EX.sizeBy] || 0;
      if (!node.heard) return isCenter ? 22 : 9;
      return Math.max(isCenter ? 22 : 6, r(v));
    };
    const nodes = [
      { ...d.center, center: true, rank: -1 },
      ...d.similar.map((s, i) => ({ ...s, center: false, rank: i })),
    ].map((nd) => {
      nd.key = nodeKey(nd);
      nd.r = radiusOf(nd, nd.center);
      const prev = EX.pos.get(nd.key);
      if (nd.center) { nd.fx = cx; nd.fy = cy; nd.x = prev?.x ?? origin?.x ?? cx; nd.y = prev?.y ?? origin?.y ?? cy; }
      else if (prev && !origin) { nd.x = prev.x; nd.y = prev.y; }
      else {
        const o = origin || { x: cx, y: cy };
        const a = Math.random() * 2 * Math.PI;
        nd.x = (prev?.x ?? o.x) + Math.cos(a) * 4; nd.y = (prev?.y ?? o.y) + Math.sin(a) * 4;
      }
      // closer = more similar
      nd.dist = nd.center ? 0 : minDim * 0.2 + (nd.rank / Math.max(1, n - 1)) * minDim * 0.2 + nd.r * 0.5;
      return nd;
    });

    let svg = d3.select(host).select("svg");
    if (svg.empty()) {
      svg = d3.select(host).insert("svg", ":first-child").attr("role", "group").attr("aria-label", "Similar artists");
      svg.append("g").attr("class", "links");
      svg.append("g").attr("class", "nodes");
    }
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    const link = svg.select(".links").selectAll("line").data(nodes.filter((x) => !x.center), (x) => x.key)
      .join((en) => en.append("line").attr("class", "link"))
      .style("opacity", (x) => 0.85 - (x.rank / Math.max(1, n)) * 0.6);

    const node = svg.select(".nodes").selectAll("g.node").data(nodes, (x) => x.key)
      .join(
        (en) => {
          const g = en.append("g").attr("class", "node").attr("tabindex", 0).attr("role", "button");
          g.append("circle").attr("class", "ring");
          g.append("circle").attr("class", "dot");
          g.append("text").attr("text-anchor", "middle");
          g.style("opacity", 0).transition().duration(350).style("opacity", 1);
          return g;
        },
        (up) => up,
        (ex) => ex.transition().duration(200).style("opacity", 0).remove(),
      )
      .classed("center", (x) => x.center)
      .attr("aria-label", (x) => `${x.name}${x.heard ? `, ${fmt(x.plays)} plays` : ", new to you"}${x.center ? " (selected)" : ""}`);

    node.select("circle.dot").transition().duration(resizeOnly ? 400 : 300).attr("r", (x) => x.r);
    node.select("circle.dot")
      .style("fill", (x) => (!x.heard ? "var(--stage)" : bucketColor(x.bucket || "Other")))
      .style("stroke", (x) => (x.center ? "var(--ink)" : x.heard ? "var(--stage)" : bucketColor(x.bucket || "Other")))
      .style("stroke-width", (x) => (x.center ? 3 : x.heard ? 2 : 2.5));
    node.select("circle.ring").attr("r", (x) => x.r + 4);
    const trunc = (s, k) => (s.length > k ? `${s.slice(0, k - 1)}…` : s);
    // on narrow screens only label the closest matches; the rest are in the tooltip/aria-label
    node.select("text").attr("y", (x) => x.r + 14)
      .text((x) => (x.center ? x.name : narrow && x.rank >= 6 ? "" : trunc(x.name, narrow ? 14 : 18)));

    node.on("click", (ev, x) => { hideTip(); if (!x.center) explore(x.id != null ? { id: x.id } : { mbid: x.mbid, name: x.name }, { x: x.x, y: x.y }); })
      .on("keydown", (ev, x) => { if ((ev.key === "Enter" || ev.key === " ") && !x.center) { ev.preventDefault(); explore(x.id != null ? { id: x.id } : { mbid: x.mbid, name: x.name }, { x: x.x, y: x.y }); } })
      .on("mouseenter focus", (ev, x) => showTip(nodeTip(x), ev))
      .on("mousemove", moveTip).on("mouseleave blur", hideTip);

    if (EX.sim) EX.sim.stop();
    EX.sim = d3.forceSimulation(nodes)
      .force("radial", d3.forceRadial((x) => x.dist, cx, cy).strength((x) => (x.center ? 0 : 0.6)))
      .force("collide", d3.forceCollide((x) => x.r + (x.center ? 18 : 14)).strength(1).iterations(3))
      .force("charge", d3.forceManyBody().strength(-30))
      .alpha(resizeOnly ? 0.4 : 1).alphaDecay(0.04)
      .on("tick", () => {
        for (const nd of nodes) {
          if (!nd.center) {
            nd.x = Math.max(nd.r + 4, Math.min(W - nd.r - 4, nd.x));
            nd.y = Math.max(nd.r + 4, Math.min(H - nd.r - (narrow ? 64 : 40), nd.y));
          }
          EX.pos.set(nd.key, { x: nd.x, y: nd.y });
        }
        node.attr("transform", (x) => `translate(${x.x},${x.y})`);
        link.attr("x1", cx).attr("y1", cy).attr("x2", (x) => x.x).attr("y2", (x) => x.y);
      });
  }

  function nodeTip(x) {
    const rows = x.heard
      ? `<div class="r"><span>All-time plays</span><span>${fmt(x.plays)}</span></div><div class="r"><span>Last 12 months</span><span>${fmt(x.plays_12m)}</span></div>`
      : `<div class="m">Not in your history yet. Click to explore.</div>`;
    const g = x.genres && x.genres.length ? `<div class="m">${esc(x.genres.join(", "))}</div>` : "";
    const rank = x.center ? "" : `<div class="m">#${x.rank + 1} most similar</div>`;
    return `<div class="t">${esc(x.name)}</div>${rows}${g}${rank}`;
  }

  function renderPanel(d) {
    const c = d.center;
    const pills = c.genres.length ? `<div>${c.genres.map((g) => `<span class="pill">${esc(g)}</span>`).join("")}</div>` : "";
    let body = "";
    if (c.heard) {
      const yearly = c.yearly || [];
      body = `
        <dl class="kv">
          <dt>All-time plays</dt><dd>${fmt(c.plays)}</dd>
          <dt>Last 12 months</dt><dd>${fmt(c.plays_12m)}</dd>
          <dt>First played</dt><dd>${esc(c.first)}</dd>
          <dt>Last played</dt><dd>${esc(c.last)}</dd>
        </dl>
        <div class="label">Plays per year</div>
        <div id="panel-years"></div>
        ${c.top_tracks?.length ? `<div class="label">Top tracks</div><ol>${c.top_tracks.map((t) => `<li>${esc(t.title)} <span>${fmt(t.plays)}</span></li>`).join("")}</ol>` : ""}
        <div class="acts" style="display:flex;gap:6px;margin-top:14px;flex-wrap:wrap">
          <a class="btn" href="../artist/${c.id}">Open in Koito</a>
          <a class="btn" href="${ytm(c.name)}" target="_blank" rel="noopener">YouTube Music ↗</a>
        </div>`;
      setTimeout(() => panelYears(yearly), 0);
    } else {
      const known = d.similar.filter((s) => s.heard).slice(0, 4).map((s) => s.name);
      body = `
        <p style="margin:8px 0"><span class="badge" style="margin:0">New to you</span></p>
        ${known.length ? `<p class="sub" style="margin-top:8px">Sits close to ${esc(known.join(", "))}, which you already play.</p>` : ""}
        <div class="acts" style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <a class="btn primary" href="${ytm(c.name)}" target="_blank" rel="noopener">Listen on YouTube Music ↗</a>
          ${c.mbid ? `<a class="btn" href="https://musicbrainz.org/artist/${esc(c.mbid)}" target="_blank" rel="noopener">MusicBrainz ↗</a>` : ""}
        </div>`;
    }
    const heardCount = d.similar.filter((s) => s.heard).length;
    const summary = d.similar.length ? `<p class="sub" style="margin-top:12px">${heardCount} of the ${d.similar.length} most similar artists are already in your history.</p>` : "";
    $("panel").innerHTML = `<h3>${esc(c.name)}</h3>${pills}${body}${summary}${d.note ? `<p class="note">${esc(d.note)}</p>` : ""}`;
  }

  function panelYears(yearly) {
    const el = $("panel-years");
    if (!el || !yearly.length) return;
    const all = DATA.overview.years.map((y) => y.year);
    const map = new Map(yearly);
    const data = all.map((y) => ({ year: y, v: map.get(y) || 0 }));
    const W = Math.max(220, el.clientWidth), H = 70;
    const x = d3.scaleBand().domain(all).range([0, W]).padding(0.25);
    const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d.v) || 1]).range([H - 14, 2]);
    const bw = Math.min(12, x.bandwidth());
    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).style("width", "100%").style("height", "auto").attr("role", "img").attr("aria-label", "Plays per year");
    svg.selectAll("path").data(data.filter((d) => d.v > 0)).join("path")
      .attr("d", (d) => roundedTop(x(d.year) + (x.bandwidth() - bw) / 2, y(d.v), bw, y(0) - y(d.v), 2))
      .style("fill", "var(--mark)")
      .on("mouseenter", (ev, d) => showTip(`<div class="t">${d.year}</div><div class="r"><span>Plays</span><span>${fmt(d.v)}</span></div>`, ev))
      .on("mousemove", moveTip).on("mouseleave", hideTip);
    svg.append("line").attr("class", "baseline").attr("x1", 0).attr("x2", W).attr("y1", y(0)).attr("y2", y(0));
    svg.append("text").attr("x", 0).attr("y", H - 1).style("fill", "var(--muted)").style("font-size", "10px").text(all[0]);
    svg.append("text").attr("x", W).attr("y", H - 1).attr("text-anchor", "end").style("fill", "var(--muted)").style("font-size", "10px").text(all[all.length - 1]);
    el.replaceChildren(svg.node());
  }

  // search
  let searchTimer = null, searchSel = -1, searchItems = [];
  const sInput = $("search"), sList = $("search-results");
  sInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = sInput.value.trim();
    if (!q) { sList.hidden = true; return; }
    searchTimer = setTimeout(async () => {
      const res = await fetch(`api/search?q=${encodeURIComponent(q)}`);
      searchItems = res.ok ? await res.json() : [];
      searchSel = -1;
      sList.innerHTML = searchItems.map((a, i) => `<li role="option" data-i="${i}">${esc(a.name)}<span>${fmt(a.plays)}</span></li>`).join("")
        || `<li aria-disabled="true">No matches</li>`;
      sList.hidden = false;
    }, 150);
  });
  sInput.addEventListener("keydown", (e) => {
    if (sList.hidden || !searchItems.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      searchSel = (searchSel + (e.key === "ArrowDown" ? 1 : -1) + searchItems.length) % searchItems.length;
      sList.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === searchSel)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickSearch(searchItems[Math.max(0, searchSel)]);
    } else if (e.key === "Escape") { sList.hidden = true; }
  });
  sList.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) { e.preventDefault(); pickSearch(searchItems[Number(li.dataset.i)]); }
  });
  sInput.addEventListener("blur", () => setTimeout(() => (sList.hidden = true), 120));
  function pickSearch(a) {
    if (!a) return;
    sList.hidden = true;
    sInput.value = "";
    explore({ id: a.id }, null, { reset: true });
  }

  function renderQuickPicks() {
    const picks = DATA.top_12m.slice(0, 10);
    $("quick-picks").innerHTML = picks.map((a) => `<button class="chip" data-pick="${a.id}">${esc(a.name)}</button>`).join("");
    $("quick-picks").onclick = (e) => {
      const b = e.target.closest("[data-pick]");
      if (b) explore({ id: Number(b.dataset.pick) }, null, { reset: true });
    };
  }

  /* ------------------------------------------------------------ boot */
  function renderAll() {
    renderGenreChart();
    renderMovers();
    renderOverTime();
    renderHeatmap();
  }

  seg("heat-toggle", (v) => { heatMode = v; renderHeatmap(); });

  let lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    if (Math.abs(window.innerWidth - lastW) < 20) return;
    lastW = window.innerWidth;
    clearTimeout(window.__rt);
    window.__rt = setTimeout(() => { drawRecord(DATA); renderInsights(DATA.insights); renderAll(); layoutDeck(); if (EX.data) drawBubbles(null, true); }, 150);
  });

  /* ------------------------------------------------------------ card deck (obsessions / comebacks / rising) */
  const DECK = { order: ["obs", "cb", "rise"], peek: 52 };
  function layoutDeck() {
    const deck = $("deck");
    if (!deck || deck.closest("[hidden]")) return;
    const cards = Object.fromEntries([...deck.querySelectorAll(".dcard")].map((c) => [c.dataset.card, c]));
    const n = DECK.order.length;
    const front = cards[DECK.order[0]];
    front.style.height = "";
    const frontH = front.scrollHeight;
    DECK.order.forEach((key, depth) => {
      const c = cards[key];
      c.style.setProperty("--depth", depth);
      c.style.zIndex = String(n - depth);
      c.style.top = `${DECK.peek * (n - 1)}px`;
      c.classList.toggle("front", depth === 0);
      c.querySelector(".dcard-body").inert = depth !== 0;
      const head = c.querySelector(".dcard-head");
      head.setAttribute("aria-expanded", String(depth === 0));
      head.tabIndex = depth === 0 ? -1 : 0;
      if (depth !== 0) c.style.height = `${frontH}px`;
    });
    deck.style.height = `${frontH + DECK.peek * (n - 1)}px`;
  }
  function bringToFront(key) {
    const i = DECK.order.indexOf(key);
    if (i <= 0) return;
    [DECK.order[0], DECK.order[i]] = [DECK.order[i], DECK.order[0]];
    layoutDeck();
  }
  $("deck").addEventListener("click", (e) => {
    const card = e.target.closest(".dcard");
    if (!card || card.classList.contains("front")) return;
    e.preventDefault();
    bringToFront(card.dataset.card);
    card.querySelector(".dcard-head").focus({ preventScroll: true });
  });

  async function boot() {
    let res;
    for (let attempt = 0; attempt < 30; attempt++) {
      res = await fetch("api/dashboard");
      if (res.ok) break;
      $("lede").textContent = "Stats are still being computed. This page will retry on its own.";
      await new Promise((r) => setTimeout(r, 4000));
    }
    if (!res.ok) { $("lede").textContent = "Stats couldn't be loaded. Check that the koito-stats service is running, then reload."; return; }
    DATA = await res.json();
    BUCKETS = DATA.genres_by_year.buckets;
    document.querySelectorAll("#main .block").forEach((s) => (s.hidden = false));
    renderHero(DATA);
    renderInsights(DATA.insights);
    renderAll();
    renderLists();
    const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    $("obs-count").textContent = plural(Math.min(12, DATA.obsessions.length), "episode", "episodes");
    $("cb-count").textContent = plural(Math.min(8, DATA.comebacks.length), "artist", "artists");
    $("rise-count").textContent = plural(Math.min(6, DATA.rising.length), "artist", "artists");
    requestAnimationFrame(layoutDeck);
    document.fonts?.ready.then(layoutDeck);
    renderRecs();
    renderQuickPicks();
    const ov = DATA.overview;
    $("foot").innerHTML = `Data: your Koito history (${fmt(ov.total_plays)} dated plays; ${fmt(ov.undated_plays)} imported plays without a date are left out). ` +
      `Genres from <a href="https://musicbrainz.org" target="_blank" rel="noopener">MusicBrainz</a>, similar artists from <a href="https://listenbrainz.org" target="_blank" rel="noopener">ListenBrainz</a>.`;
    if (DATA.top_12m.length) explore({ id: DATA.top_12m[0].id }, null, { reset: true });
  }
  boot();
})();
