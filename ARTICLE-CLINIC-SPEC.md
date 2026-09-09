# Article Clinic

Version: pilot-v0.1  
Date: 9 September 2026

## Purpose

Article Clinic is a revision coach for serious article writing. It diagnoses a submitted draft, identifies the few changes that would improve it most, and asks focused questions that help the writer revise their own work.

It is designed to support more than feature articles. The first pilot will be tested mainly on KCMJ 674 feature/profile drafts, but the underlying tool should also work for news features, explainers, analysis, opinion/columns, magazine pieces, newsletters/blog articles and other article forms.

Article Clinic is not a ghostwriter, final marker, plagiarism detector, automatic fact checker or automated grading system.

## Pilot scope

The first version reviews article text only.

Not in v0.1:
- magazine/DPS layout review;
- reflection review;
- automated scoring or marks;
- external web fact verification;
- full-article rewriting;
- replacement headlines by default.

## Inputs

Required:
- Pilot access code
- Article type
- Article text

Optional:
- Proposed headline
- Intended publication / audience
- Assignment brief or publication requirements

Article types:
- Feature / profile
- News feature
- Explainer
- Analysis
- Opinion / column
- Magazine / lifestyle
- Newsletter / blog article
- Other

Article text limits for the pilot:
- minimum 500 characters
- maximum 20,000 characters

## Editorial priorities

The Clinic adapts its judgement to the article type, audience and brief supplied by the user. It should normally consider:

1. Angle and story proposition
2. Headline and opening alignment
3. Structure and narrative movement
4. Reporting or evidential depth
5. Sources, attribution and verification needs
6. Quote integrity and quote selection where relevant
7. Showing versus telling where relevant
8. Voice, tone and overwriting
9. Ending / conclusion
10. Specific copy-editing issues

Journalism, evidence and structural problems outrank copy-editing problems.

## Coaching rules

- Begin with genuine strengths worth preserving.
- Identify only 3–5 highest-impact revision priorities.
- Ground findings in the submitted article.
- Use questions as coaching tools.
- Do not write a replacement article.
- Do not generate a replacement headline in the first response.
- Do not silently improve direct quotations.
- Do not assume every article should use a feature-style scene or narrative structure.
- Judge structure and voice against the selected article type.
- Do not use outside knowledge to confirm or contradict factual claims in this pilot.
- Flag material that should be independently checked.
- Use Human review required sparingly.

## Result structure

The response contains:
- Overall diagnosis
- 1–4 strengths
- 2–5 revision priorities
- Headline and opening note
- Sources / evidence / quotations note
- Ending / conclusion note
- Specific copy-editing points where warranted
- 2–5 quick revision actions
- Optional warnings

No numeric score is returned.

## Integrity and verification rules

If a vivid scene may be reconstructed, the Clinic must not accuse the writer of invention. It should ask whether the details were actually observed or properly sourced.

If a direct quote sounds unusually polished or perfectly thematic, the Clinic should advise checking it against the recording or notes rather than claiming it is fabricated.

If a source is unnamed without an obvious reason, flag identification/anonymity as a reporting issue.

If a factual, historical, institutional, political, legal or sporting claim needs checking, say it should be independently verified. Do not fact-check it from model memory.

## Warning levels

### Check carefully

A meaningful uncertainty or reporting concern the writer should verify.

Examples:
- a scene may have been reconstructed rather than observed;
- an anonymous source lacks an obvious reason for anonymity;
- a claim needs independent verification;
- a quotation should be checked against notes or a recording.

### Human review required

Use only for concerns that should not be resolved solely by automated coaching.

Examples:
- unresolved allegation;
- serious privacy or identification concern;
- potentially defamatory wording;
- serious factual contradiction;
- confidential-source issue;
- substantial ethical uncertainty.

## Privacy

The interface should warn users not to submit confidential, embargoed, source-identifying, legally sensitive or otherwise restricted material.

The function must not log article text, headline, brief, prompt, model output or access code.

OpenAI request:
- `store: false`
- structured output
- no retrieval or web use

## Pilot test

Run the five September KCMJ 674 drafts through the tool and compare the output with the human coaching notes captured in `CCC_Feature_Article_Clinic_Lessons_and_Requirements_Sep_2026.md`.

The pilot succeeds if it reliably:
- finds the central angle;
- prioritises a few meaningful issues rather than grammar;
- catches CV-like chronology where relevant;
- distinguishes showing from telling where relevant;
- identifies missing reporting or evidence;
- questions unverified scenes/quotes without accusing the writer;
- notices weak or anonymous sourcing;
- gives accurate copy-editing examples;
- produces a genuinely useful short revision plan;
- avoids rewriting the article.
