import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import mermaid from 'astro-mermaid';
import remarkLinks from './src/remark-links.mjs';

const base = process.env.BASE ?? '/stamp';
export default defineConfig({
  site: process.env.SITE ?? 'https://jagreehal.github.io',
  base,
  trailingSlash: 'always',
  markdown: { processor: unified({ remarkPlugins: [[remarkLinks, { defaultBase: '/stamp', base }]] }) },
  integrations: [
    mermaid({ theme: 'neutral', autoTheme: true }),
    starlight({
      title: 'Stamp',
      description: 'Review and approve pull requests under your team policy.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/jagreehal/stamp' }],
      editLink: { baseUrl: 'https://github.com/jagreehal/stamp/edit/main/docs/' },
      sidebar: [
  {
    "label": "Start here",
    "items": [
      {
        "label": "Overview",
        "slug": ""
      },
      {
        "label": "First run",
        "slug": "start/quickstart"
      },
      {
        "label": "Choose a setup",
        "slug": "start/choose-a-setup"
      }
    ]
  },
  {
    "label": "Guides",
    "items": [
      {
        "label": "Review a PR from your terminal",
        "slug": "guides/local-review"
      },
      {
        "label": "Understand a verdict",
        "slug": "guides/verdicts"
      },
      {
        "label": "Connect a repository",
        "slug": "guides/installation"
      },
      {
        "label": "Review workflow",
        "slug": "guides/review-workflow"
      },
      {
        "label": "Ownership and independent reviews",
        "slug": "guides/team-adoption"
      },
      {
        "label": "Read CI test evidence",
        "slug": "guides/test-evidence"
      },
      {
        "label": "Stacked PRs and wrong bases",
        "slug": "guides/stacked-prs"
      }
    ]
  },
  {
    "label": "Configuration",
    "items": [
      {
        "label": "Configuration reference",
        "slug": "reference/configuration"
      },
      {
        "label": "Policy, gates and tiers",
        "slug": "configuration/policy"
      },
      {
        "label": "Team examples",
        "slug": "configuration/examples"
      },
      {
        "label": "Share team review rules",
        "slug": "configuration/rule-packs"
      },
      {
        "label": "Author familiarity",
        "slug": "configuration/author-context"
      }
    ]
  },
  {
    "label": "Integrations",
    "items": [
      {
        "label": "Notifications and Slack digest",
        "slug": "integrations/notifications"
      },
      {
        "label": "Use Stamp with Shepherd",
        "slug": "integrations/shepherd"
      }
    ]
  },
  {
    "label": "Operations",
    "items": [
      {
        "label": "Approval retention",
        "slug": "operations/approval-retention"
      },
      {
        "label": "Troubleshooting",
        "slug": "operations/troubleshooting"
      },
      {
        "label": "Upgrades and maintenance",
        "slug": "operations/upgrades"
      }
    ]
  },
  {
    "label": "Concepts",
    "items": [
      {
        "label": "Trust and approval safety",
        "slug": "concepts/security"
      }
    ]
  },
  {
    "label": "Reference",
    "items": [
      {
        "label": "Commands",
        "slug": "reference/commands"
      },
      {
        "label": "Environment and credentials",
        "slug": "reference/environment"
      },
      {
        "label": "Backends, providers and isolation",
        "slug": "reference/backends"
      },
      {
        "label": "Credits",
        "slug": "reference/credits"
      }
    ]
  },
  {
    "label": "Contributing",
    "items": [
      {
        "label": "Documentation",
        "slug": "contributing/docs"
      }
    ]
  }
],
    }),
  ],
});
