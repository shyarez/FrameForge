# FrameForge Studio

### An Intelligent Visual Video Editor with Evidence-Aware Data Storytelling

**FrameForge Studio** is a web-based video editing and generation platform that combines intuitive visual editing, programmatic video rendering, and intelligent data storytelling.

The application aims to make video creation accessible through a drag-and-drop editing workspace while retaining the flexibility of structured, code-driven video generation.

Unlike a conventional video editor, FrameForge also explores how structured datasets can be transformed into animated, editable visual narratives, with analytical claims connected to their underlying data.

## Overview

FrameForge brings together two primary workflows:

- **Visual Video Editing:** Create and customize videos using an interactive canvas, editable elements, layers, scenes, animations, and timeline controls.
- **Intelligent Data Storytelling:** Import structured datasets, generate analytical insights, and transform them into animated infographic-style video scenes.

Rather than treating videos solely as finished media files, FrameForge represents them as structured compositions that can be edited, previewed, and rendered.

## Key Features

- **Visual Editor:** Interactive canvas for arranging and customizing text, images, shapes, and other supported elements.
- **Scene-Based Timeline:** Organize video scenes, manage durations, and configure animations.
- **Editable Compositions:** Modify generated content instead of being restricted to fixed templates.
- **Data-Driven Storytelling:** Convert supported datasets into charts, insights, and animated visual narratives.
- **Evidence-Aware Analytics:** Associate numerical claims with deterministic calculations and their source data.
- **Video Preview and Export:** Preview compositions and render them into supported video formats.
- **Structured Project Management:** Store and reload editable video projects.

*Feature availability depends on the current implementation. Incomplete features should be identified as experimental or planned.*

## What Makes FrameForge Different?

FrameForge's distinguishing direction is the integration of **visual video editing, evidence-linked analytics, and dependency-aware content generation**.

Traditional editors focus primarily on arranging and animating media. Programmatic video frameworks focus on defining and rendering video through code.

FrameForge aims to combine these approaches while introducing a stronger connection between a video's content and the data supporting it.

### Evidence-Aware Incremental Video Generation (EAIVG)

FrameForge explores a proposed mechanism called **Evidence-Aware Incremental Video Generation (EAIVG)**.

Its purpose is to track relationships between:

**Dataset → Calculations → Verified Insights → Visual Elements → Video Scenes**

When source data changes, the system can identify which analytical results and scene elements depend on that data.

The intended outcome is to update affected content while preserving unrelated scenes and user-defined visual customizations.

This introduces three important goals:

1. **Traceability:** Numerical claims can be linked to their source calculations.
2. **Editability:** Automatically generated visualizations remain customizable.
3. **Incremental Updates:** Data changes can propagate to relevant scene elements without unnecessarily regenerating unrelated content.

True incremental *video rendering*, including segment caching and selective rerendering, is a separate technical capability that requires implementation and performance validation.

## How It Works

```text
        Visual Editing
              |
              v
      Structured Scene Model <------ Dataset Import
              |                          |
              |                          v
              |                  Data Analysis
              |                          |
              |                          v
              |                  Evidence & Insights
              |                          |
              +-------------+------------+
                            |
                            v
                     Video Timeline
                            |
                            v
                    Preview & Render
                            |
                            v
                       Video Export
```

Users can create scenes manually or use supported data-storytelling features to generate editable visual content. The structured scene model connects the editor to the video-rendering pipeline.

## Technology

FrameForge is designed around modern web technologies, including React, Next.js, TypeScript, and browser-based rendering tools.

The exact technology stack, installation instructions, and configuration requirements should reflect the dependencies actually present in the repository.

## Project Objectives

FrameForge aims to:

- Simplify video creation through an accessible visual workspace.
- Combine manual editing with structured video generation.
- Support reliable, data-driven animated storytelling.
- Improve transparency through evidence-linked numerical claims.
- Investigate selective content updates when source datasets change.

## Project Status

FrameForge Studio is an evolving academic software project. Features should be classified as implemented, experimental, or planned based on their actual functionality and test results.

## Vision

**Create visually. Analyze reliably. Tell stories that stay connected to their data.**

FrameForge explores a future where videos are not only visually editable, but also structured, traceable, and adaptable as the information behind them changes.
