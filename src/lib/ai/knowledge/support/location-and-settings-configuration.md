# Location & Settings Configuration

## Overview

Opus EHR is organized by locations within a tenant. Many features, forms, and settings are configured at the location level. Understanding the location hierarchy and settings structure is essential for troubleshooting "why can't I see X" tickets.

## Location Creation & Structure

- Each tenant can have multiple locations.
- Locations represent physical sites or organizational units.
- Patients belong to one location at a time.

## Forms Per Location

- Clinical forms and templates can be configured differently per location.
- A form available at one location may not be available at another.

## Levels of Care

- Levels of care are configured per location.
- Used for inpatient/residential settings to define the type of care provided.

## Places of Service

- Places of service codes identify where care was delivered.
- Used for billing purposes on encounters and claims.
- Can be used as an alternative to multiple locations when patients are seen at different sites.

## Reminder Settings

- Appointment reminder timing is configurable per location in Settings.
- Default is 48 hours before the appointment.
- Reminders are sent via email and text (SMS) if contact info is on file.

## Hours of Operation

- Configurable per location.
- Affects scheduling availability and display.

## Global vs. Location-Specific Settings

- Some settings apply globally across the tenant.
- Others are location-specific and must be configured for each location individually.
- This distinction is a common source of confusion.

## Common Issues in Support Tickets

### "Feature/form is available at one location but not another"
- Check the location-specific configuration for forms, templates, and settings.

### "Tabs are missing in All Locations view"
- By design, only a limited set of tabs are shown in All Locations view (Patients, Documents, Schedule, Groups, Billing). Some tabs are location-specific.

### "Reminders aren't being sent"
- Check the reminder settings for the specific location.
- Verify the patient has email and/or phone on file.

### "Schedule shows wrong hours"
- Check the hours of operation configuration for the location.
