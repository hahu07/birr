---
sidebar_position: 1
slug: /
title: Start Here
description: What this site is, who it's for, and how it's kept private.
---

# Birr — Internal Staff Documentation

This site documents how Birr's own staff actually operate the
platform: the Ops Console, internal processes, and anything else that
isn't safe or useful to show a Founder, a donor, or the general public.

If you're looking for the public product documentation instead — what
Birr is, how Waqf Funds and Vaults work, the governance model — that
lives at the separate, public [birr-docs](https://birr-docs.onrender.com)
site.

## Why this is a separate site

Birr's public docs site is deliberately readable by anyone — a
prospective Founder, a partner institution, an auditor. This site is
not: it describes internal role permissions, the approval queue,
compliance review tooling, and admin settings. Mixing the two would
mean either watering down the internal content until it's safe for a
stranger to read, or exposing operational detail that should stay
inside Birr. Two sites, two audiences.

Access to this site is meant to be restricted to selected Birr staff
via Cloudflare Access in front of it, not by an in-app login — see this
project's own `render.yaml` for the deployment, and ask a platform
admin if you believe you should have access but don't.

## What's here today

- [The Ops Console](./ops-console) — a menu-by-menu, plain-English
  guide to Birr's staff console.

More internal guides (runbooks, deployment notes, on-call procedures)
can be added here the same way as this first one, following the same
plain-English-with-examples style.
