const fs = require('fs');
const path = require('path');
const { instance } = require('@viz-js/viz');
const sharp = require('sharp');

const OUT = path.join(__dirname, 'diagrams');
fs.mkdirSync(OUT, { recursive: true });

const palette = {
  navy: '#0E1B2E',
  blue: '#1F6897',
  cyan: '#20BAD0',
  pink: '#DE449F',
  ink: '#1C232D',
  muted: '#5C6877',
  light: '#EEF3F8',
  white: '#FFFFFF',
  edge: '#A8BBCB',
  green: '#1C8B76',
  gold: '#D49A2E',
};

const shared = `
  graph [bgcolor="transparent", pad="0.22", nodesep="0.36", ranksep="0.55", fontname="Arial", outputorder="edgesfirst"];
  node [shape=rect, style="rounded,filled", fontname="Arial", fontsize=11, margin="0.16,0.10", color="${palette.edge}", fillcolor="${palette.white}", fontcolor="${palette.ink}", penwidth=1.2];
  edge [fontname="Arial", fontsize=9, color="${palette.edge}", fontcolor="${palette.muted}", penwidth=1.5, arrowsize=0.72];
`;

const diagrams = [
  {
    file: 'magic-city-orchestration.png',
    width: 1800,
    dot: `digraph G {
      ${shared}
      rankdir=TB;

      user [label=<<B>USER</B><BR/><FONT POINT-SIZE="10">Plain-language request</FONT>>, fillcolor="#FFF4FA", color="${palette.pink}", penwidth=2];

      subgraph cluster_mc {
        label=<<B>MAGIC CITY CONTROL PLANE</B>>;
        labelloc="t";
        fontsize=13;
        fontname="Arial";
        fontcolor="${palette.navy}";
        color="#CAD8E4";
        style="rounded,filled";
        fillcolor="#F7FAFC";
        margin=18;

        chat [label=<<B>1  INTERPRET</B><BR/><FONT POINT-SIZE="10">Chat + OpenRouter</FONT>>];
        sheet [label=<<B>2  FREEZE</B><BR/><FONT POINT-SIZE="10">Execution sheet</FONT>>];
        mission [label=<<B>3  AUTHORIZE</B><BR/><FONT POINT-SIZE="10">Mission policy + capability</FONT>>, fillcolor="#E9FBFD", color="${palette.cyan}", penwidth=2];
        pay [label=<<B>4  FUND</B><BR/><FONT POINT-SIZE="10">Credits | Stripe | Base USDC</FONT>>];
        output [label=<<B>5  DELIVER</B><BR/><FONT POINT-SIZE="10">Status + artifacts + receipt</FONT>>];

        { rank=same; chat; sheet; mission; }
        chat -> sheet -> mission;
        pay -> mission [dir=back, label="payment context"];
      }

      runner [label=<<B>MAGIC INTERNET AGENT</B><BR/><FONT POINT-SIZE="10">Chrome Runner + AMBA</FONT>>, fillcolor="#EFF9F7", color="${palette.green}", penwidth=2];
      clawz [label=<<B>SANTACLAWZ AGENTS</B><BR/><FONT POINT-SIZE="10">Concierge + x402</FONT>>, fillcolor="#FFF8EA", color="${palette.gold}", penwidth=2];
      proof [label=<<B>ZEKO PROOF PLANE</B><BR/><FONT POINT-SIZE="10">Proof worker + relayer + zkApp</FONT>>, fillcolor="#F3F0FF", color="${palette.pink}", penwidth=2];

      { rank=source; user; }
      user -> chat;
      { rank=same; runner; clawz; }
      { rank=same; output; proof; }
      mission -> runner [label="local browser path"];
      mission -> clawz [label="independent agent path"];
      runner -> output;
      clawz -> output;
      runner -> proof [label="AMBA receipt"];
      output -> user [label="result", color="${palette.cyan}", penwidth=2, constraint=false];
      proof -> output [label="anchor reference"];
    }`,
  },
  {
    file: 'magic-city-amba-lifecycle.png',
    width: 1800,
    dot: `digraph G {
      ${shared}
      rankdir=TB;
      node [width=1.58];

      approve [label=<<B>USER APPROVES</B><BR/><FONT POINT-SIZE="9">task | site | cap | stops</FONT>>, fillcolor="#FFF4FA", color="${palette.pink}", penwidth=2];
      policy [label=<<B>CANONICAL POLICY</B><BR/><FONT POINT-SIZE="9">hash + capability</FONT>>];
      runner [label=<<B>RUNNER VERIFIES</B><BR/><FONT POINT-SIZE="9">domain | action | order | budget</FONT>>, fillcolor="#E9FBFD", color="${palette.cyan}", penwidth=2];
      action [label=<<B>APPROVED ACTION</B><BR/><FONT POINT-SIZE="9">one browser primitive</FONT>>];
      checkpoint [label=<<B>SIGNED CHECKPOINT</B><BR/><FONT POINT-SIZE="9">Ed25519 + previous hash</FONT>>, fillcolor="#EFF9F7", color="${palette.green}", penwidth=2];
      receipt [label=<<B>TERMINAL RECEIPT</B><BR/><FONT POINT-SIZE="9">trace root + nullifier</FONT>>];
      zeko [label=<<B>ZEKO COMMITMENT</B><BR/><FONT POINT-SIZE="9">statement hash + digest</FONT>>, fillcolor="#F3F0FF", color="${palette.pink}", penwidth=2];

      { rank=same; approve; policy; runner; }
      { rank=same; action; checkpoint; receipt; }
      approve -> policy -> runner -> action -> checkpoint;
      checkpoint -> action [label="next boundary", style=dashed, color="${palette.cyan}"];
      checkpoint -> receipt [label="terminal state"];
      receipt -> zeko [label="off-chain verify, then relay"];

      private [shape=note, label=<<B>PRIVATE DATA STAYS OFF-CHAIN</B><BR/><FONT POINT-SIZE="9">prompts | page contents | credentials | cart details | artifacts</FONT>>, fillcolor="#F7FAFC", color="#CAD8E4", fontcolor="${palette.muted}"];
      { rank=same; zeko; private; }
      private -> zeko [style=dotted, arrowhead=none, label="never published"];
    }`,
  },
  {
    file: 'magic-city-santaclawz-market.png',
    width: 1800,
    dot: `digraph G {
      ${shared}
      rankdir=TB;

      demand [label=<<B>RETAIL DEMAND</B><BR/><FONT POINT-SIZE="10">Search + chat request</FONT>>, fillcolor="#FFF4FA", color="${palette.pink}", penwidth=2];
      rank [label=<<B>MAGIC CITY DISCOVERY</B><BR/><FONT POINT-SIZE="9">task fit | availability | price<BR/>history | proof | saved agents</FONT>>, fillcolor="#E9FBFD", color="${palette.cyan}", penwidth=2];
      preflight [label=<<B>AGENT PREFLIGHT</B><BR/><FONT POINT-SIZE="9">Ask only for declared inputs</FONT>>];
      concierge [label=<<B>SANTACLAWZ CONCIERGE</B><BR/><FONT POINT-SIZE="9">package | quote | x402 | dispatch</FONT>>, fillcolor="#FFF8EA", color="${palette.gold}", penwidth=2];

      subgraph cluster_market {
        label=<<B>OPEN AGENT MARKET</B>>;
        labelloc="t";
        fontsize=13;
        fontname="Arial";
        fontcolor="${palette.navy}";
        color="#CAD8E4";
        style="rounded,filled";
        fillcolor="#F7FAFC";
        margin=16;
        audit [label=<<B>CODE AUDITOR</B><BR/><FONT POINT-SIZE="9">repository analysis</FONT>>];
        research [label=<<B>RESEARCH AGENT</B><BR/><FONT POINT-SIZE="9">specialized insight</FONT>>];
        custom [label=<<B>YOUR AGENT</B><BR/><FONT POINT-SIZE="9">independent operator</FONT>>];
        { rank=same; audit; research; custom; }
      }

      delivery [label=<<B>MAGIC CITY DELIVERY</B><BR/><FONT POINT-SIZE="9">live status | artifact | receipt</FONT>>, fillcolor="#EFF9F7", color="${palette.green}", penwidth=2];
      user [label=<<B>USER</B><BR/><FONT POINT-SIZE="9">result + saved preference</FONT>>];
      payment [shape=note, label=<<B>PAYMENT</B><BR/><FONT POINT-SIZE="9">Credits or Base USDC x402</FONT>>, fillcolor="#F3F0FF", color="${palette.pink}"];

      { rank=source; demand; payment; }
      { rank=same; rank; preflight; concierge; }
      demand -> rank -> preflight -> concierge;
      concierge -> audit;
      concierge -> research;
      concierge -> custom;
      audit -> delivery;
      research -> delivery;
      custom -> delivery;
      { rank=sink; delivery; user; }
      delivery -> user [color="${palette.cyan}", penwidth=2];
      user -> rank [label="save + reputation signal", style=dashed, constraint=false];
      payment -> concierge [label="exact job payment"];
    }`,
  },
];

async function main() {
  const viz = await instance();
  for (const diagram of diagrams) {
    const svg = viz.renderString(diagram.dot, { format: 'svg', engine: 'dot' });
    const target = path.join(OUT, diagram.file);
    await sharp(Buffer.from(svg))
      .resize({ width: diagram.width, withoutEnlargement: false })
      .flatten({ background: '#FFFFFF' })
      .png({ compressionLevel: 9 })
      .toFile(target);
    console.log(target);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
