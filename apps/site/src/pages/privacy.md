---
layout: ../layout.astro
title: Privacy policy
description: What LingerCam stores about hosts and guests, why, who processes it, and how to delete it.
updated: 2 November 2026
---

> **Draft for lawyer review.** This is a first draft written to describe what the product actually
> does. It has not been reviewed by a lawyer and is not yet the final policy.

LingerCam is a shared event camera made by GalleoApp, Inc. ("we"). A host creates an event, guests
join from a QR code or link and take photos, and the photos are revealed to the event at a time the
host chooses. This policy explains what we store to make that work, why, and how to remove it.

## What we store

### Hosts

- **Account email and name.** You sign in with a six-digit code sent to your email. We store the
  email address and the name you give, and a hashed copy of each sign-in code until it is used or
  expires.
- **Sessions.** When you sign in we store a hashed session token so the app stays signed in.
- **Event data.** For each event: its title, occasion, start and end times, time zone, reveal
  settings, shots per guest, who can see the photos, the film look, the event code and an optional
  cover photo.
- **Purchase records.** When you pay for an event we store the product, the store it came from
  (App Store, Google Play or Stripe), the transaction id and the event it applies to. We never
  receive your card number. Apple, Google and Stripe process the payment under their own policies.
- **Push tokens.** If you allow notifications, we store the push token your phone gives us so we
  can tell you when an event is revealed.

### Guests

Guests don't create an account.

- **Name.** The name you enter when you join an event, shown next to your photos.
- **Device id.** A random id that the app or browser creates the first time you join an event. It
  lets us recognise your phone so you keep your place and your shot count. It is not linked to your
  phone's advertising id or hardware identifiers.
- **Photos.** The developed version of each photo you take, with the event's film look, and a
  smaller thumbnail, along with the time it was taken and its size. The photo as your camera took
  it is deleted once it has been developed, and the developed copies carry no location or other
  camera metadata.
- **Likes and reports.** Which photos you liked or reported, so each person counts once.
- **Push tokens.** If you allow notifications, the push token for your phone, so we can tell you
  when the photos are ready.
- **Email address, if you leave one.** A guest using the browser can leave an email address to be
  told when the photos are ready. We use it for that one email and for a link that opens the event
  as you in another browser or on another phone, which we send again if you ask for it. We store
  the address and a hashed copy of the token in the latest link. We don't use it for anything
  else or add it to a mailing list.

## Who sees what

Before the reveal, LingerCam doesn't show the photos to anyone, the host included. After the reveal, the people at the event see the photos according to the host's setting: either
every guest sees every photo, or each guest sees their own and the host sees all of them. Every
photo shows the name of the guest who took it.

The host can hide any photo. Anyone at the event can report a photo, and a photo reported by three
people is hidden and the host is told.

## How we use it

We use this information only to run LingerCam: to sign you in, run your events, store and reveal the
photos, send the notifications you asked for, apply purchases and answer support requests. We
don't sell personal information, show ads or use photos to train models.

## Services that process data for us

- **Render** hosts the API and the database.
- **Cloudflare R2** stores photos.
- **An email provider** delivers sign-in codes and the guests' reveal emails. [To name before
  publishing.]
- **Expo** delivers push notifications.
- **RevenueCat** verifies App Store and Google Play purchases. **Stripe** processes web payments.

This website loads its serif font from Google Fonts, which means Google receives your IP address
when you open a page. The site doesn't use cookies or analytics.

## How long we keep it

Events and photos stay available to the event's members until the host deletes the event or their
account. A guest's email address is kept with their place in the event until they ask us to
remove it or the event is deleted. Sign-in codes expire after a short time. When an event is
deleted, we delete what we store for it: its guests' names, email addresses and photos, likes,
reports, purchase records and the stored photo files. When an account is deleted, we do the same
for each of the host's events and also delete the host's push tokens. A guest's push token
belongs to the phone, not to one event, so it isn't deleted with an event. We delete it when
the push service tells us it no longer works, for example after the app is removed. [To confirm before
publishing: retention of backups and any records we must keep for tax purposes.]

## Deleting your data

**Hosts** can delete their account in the app under Settings, or by emailing
[support@lingercam.app](mailto:support@lingercam.app) from the account's email address. See
[Delete your account](/delete-account/) for what that removes.

**Guests** can remove their own photos from an event after the reveal, from the photo's menu.
Before the reveal, or to remove your name or email address, email
[support@lingercam.app](mailto:support@lingercam.app) with the event name and the name you joined
under, and we'll remove them from that event. You can also ask the host to hide a photo.

## Children

LingerCam isn't directed at children under 13, and hosts must be at least 18 or have a parent's
permission. [To confirm the minimum ages for each region.]

## Your rights

Depending on where you live, you may have the right to access, correct, export or delete your
information, or to object to how we use it. Email
[support@lingercam.app](mailto:support@lingercam.app) and we'll respond. You can also complain to
your local data protection authority.

## Changes

If we change this policy we'll update the date at the top, and tell hosts in the app when the
change is significant.

## Contact

GalleoApp, Inc. [Postal address to add.]

Email: [support@lingercam.app](mailto:support@lingercam.app)
