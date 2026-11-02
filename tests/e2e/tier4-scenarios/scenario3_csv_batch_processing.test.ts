/**
 * LocalFlow E2E Test Suite - Tier 4: Scenario 3 - CSV Batch Processing & Enrichment
 * Full Real-World Application Scenario:
 * CSV Parse -> Filter Rows -> For Each Loop -> HTTP Enrichment -> CSV Generate -> Filesystem Export
 */

import { describe, it, expect, beforeEach } from '../harness/index.ts';
import { WorkflowRunner } from '../harness/workflow-runner.ts';
import { InMemoryDatabase } from '../harness/db-mock.ts';
import { mockServiceRouter } from '../harness/msw-handlers.ts';
import type { WorkflowDefinition } from '../harness/types.ts';

describe('Tier 4: Scenario 3 - CSV Batch Ingestion, Enrichment & Filesystem Export', () => {
  const runner = new WorkflowRunner();
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
    runner.resetFs();
    mockServiceRouter.reset();
  });

  it('S3-1: should parse CSV, filter target records, iterate with For Each, enrich via HTTP, and write enriched CSV to disk', async () => {
    const rawCsvData = [
      'id,name,tier,country',
      '1,Acme Industrial,ENTERPRISE,US',
      '2,Beta Logistics,STARTER,EU',
      '3,Gamma Robotics,ENTERPRISE,US',
      '4,Delta Commerce,COMMUNITY,APAC'
    ].join('\n');

    const workflow: WorkflowDefinition = {
      id: 'wf_scenario_csv_batch',
      workspaceId: 'ws_prod_scenarios',
      name: 'Customer CSV Ingestion and Enrichment Pipeline',
      version: 1,
      nodes: [
        {
          id: 'node_trigger',
          type: 'trigger.manual',
          name: 'Manual CSV Ingestion',
          position: { x: 0, y: 0 },
          data: { config: {} }
        },
        {
          id: 'node_csv_parse',
          type: 'core.csv',
          name: 'Parse Inbound CSV',
          position: { x: 150, y: 0 },
          data: {
            config: {
              action: 'parse',
              csvText: '{{ $trigger.csvData }}'
            }
          }
        },
        {
          id: 'node_filter',
          type: 'primitive.filter',
          name: 'Filter Enterprise US Customers',
          position: { x: 300, y: 0 },
          data: {
            config: {
              items: '{{ $nodes.node_csv_parse.output }}',
              predicate: '{{ $item.tier === "ENTERPRISE" && $item.country === "US" }}'
            }
          }
        },
        {
          id: 'node_foreach',
          type: 'primitive.forEach',
          name: 'Iterate Filtered Customers',
          position: { x: 450, y: 0 },
          data: {
            config: {
              items: '{{ $nodes.node_filter.output.passed }}'
            }
          }
        },
        {
          id: 'node_http',
          type: 'core.httpRequest',
          name: 'Lookup Customer Risk Score',
          position: { x: 600, y: 0 },
          data: {
            config: {
              url: 'https://httpbin.org/get',
              method: 'GET'
            }
          }
        },
        {
          id: 'node_csv_gen',
          type: 'core.csv',
          name: 'Generate Export CSV',
          position: { x: 750, y: 0 },
          data: {
            config: {
              action: 'generate',
              data: '{{ $nodes.node_filter.output.passed }}'
            }
          }
        },
        {
          id: 'node_fs_write',
          type: 'core.filesystem',
          name: 'Export Clean CSV to Sandbox',
          position: { x: 900, y: 0 },
          data: {
            config: {
              action: 'writeFile',
              path: 'exports/enterprise_us_customers.csv',
              content: '{{ $nodes.node_csv_gen.output }}'
            }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'node_trigger', target: 'node_csv_parse', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e2', source: 'node_csv_parse', target: 'node_filter', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e3', source: 'node_filter', target: 'node_foreach', sourceHandle: 'passed', targetHandle: 'main' },
        { id: 'e4', source: 'node_foreach', target: 'node_http', sourceHandle: 'done', targetHandle: 'main' },
        { id: 'e5', source: 'node_http', target: 'node_csv_gen', sourceHandle: 'main', targetHandle: 'main' },
        { id: 'e6', source: 'node_csv_gen', target: 'node_fs_write', sourceHandle: 'main', targetHandle: 'main' }
      ]
    };

    const result = await runner.runWorkflow(workflow, {
      triggerPayload: { csvData: rawCsvData },
      mockDatabase: db,
      allowedFsRoot: '/data/exports'
    });

    expect(result.execution.status).toBe('SUCCEEDED');

    // 1. Check CSV parse produced 4 records
    const parseOut = result.nodeOutputs.get('node_csv_parse') as any[];
    expect(parseOut.length).toBe(4);

    // 2. Filter should retain exactly 2 ENTERPRISE US records
    const filterOut = result.nodeOutputs.get('node_filter') as { count: number; passed: any[] };
    expect(filterOut.count).toBe(2);
    expect(filterOut.passed[0].name).toBe('Acme Industrial');
    expect(filterOut.passed[1].name).toBe('Gamma Robotics');

    // 3. ForEach processed 2 items
    const forEachOut = result.nodeOutputs.get('node_foreach') as { total: number };
    expect(forEachOut.total).toBe(2);

    // 4. HTTP call succeeded
    const httpOut = result.nodeOutputs.get('node_http') as { status: number };
    expect(httpOut.status).toBe(200);

    // 5. CSV generated string contains headers and filtered rows
    const csvGenOut = result.nodeOutputs.get('node_csv_gen') as string;
    expect(csvGenOut.includes('Acme Industrial')).toBe(true);
    expect(csvGenOut.includes('Gamma Robotics')).toBe(true);
    expect(csvGenOut.includes('Beta Logistics')).toBe(false);

    // 6. Filesystem export written successfully
    const fsOut = result.nodeOutputs.get('node_fs_write') as { written: boolean; path: string; sizeBytes: number };
    expect(fsOut.written).toBe(true);
    expect(fsOut.path).toBe('/data/exports/exports/enterprise_us_customers.csv');
    expect(fsOut.sizeBytes).toBeGreaterThan(0);
  });
});
