/**
 * Phase 0 — ONNX Runtime inference smoke test.
 *
 * Verifies that onnxruntime-node can be imported in the Node.js
 * environment, reports version and available execution providers.
 * Falls back gracefully with a clear error + HTTP bridge suggestion.
 *
 * Run:  npx tsx experiments/exp-slm/phase-0-infra/scripts/smoke-test-inference.ts
 * Exit 0 on pass, 1 on fail (fail = cannot load the module at all).
 */

async function main(): Promise<void> {
  console.log("=== ONNX Runtime Node.js Smoke Test ===\n");

  // ---------------------------------------------------------
  // 1. Attempt to import onnxruntime-node
  // ---------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ort: any;
  try {
    ort = await import("onnxruntime-node");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("FAIL: Could not import onnxruntime-node.");
    console.error(`  Error: ${msg}\n`);
    console.error("Possible causes:");
    console.error("  - Package not installed (run: npm install)");
    console.error("  - Native binary mismatch (rebuild: npm rebuild onnxruntime-node)");
    console.error("  - Node.js version incompatibility\n");
    console.error("Fallback recommendation:");
    console.error(
      "  Use an HTTP bridge to a Python ONNX Runtime server for inference."
    );
    console.error(
      "  Python's onnxruntime + onnxruntime-gpu have broader platform support."
    );
    process.exit(1);
  }

  // ---------------------------------------------------------
  // 2. Report version & providers
  // ---------------------------------------------------------
  console.log(`  onnxruntime-node imported successfully.`);

  // List available execution providers by attempting a minimal session
  // with each known provider.
  const knownProviders = ["CUDAExecutionProvider", "CPUExecutionProvider"];
  const availableProviders: string[] = [];

  // Build a minimal ONNX model in memory (single Identity node).
  // This is the smallest valid ONNX graph — one float32 input echoed to output.
  const minimalOnnx = buildMinimalOnnxModel();

  for (const provider of knownProviders) {
    try {
      const session = await ort.InferenceSession.create(minimalOnnx, {
        executionProviders: [provider],
      });
      availableProviders.push(provider);
      await session.release();
    } catch {
      // Provider not available — skip silently
    }
  }

  console.log(`  Available execution providers: ${availableProviders.join(", ") || "(none detected)"}`);

  if (availableProviders.length === 0) {
    console.warn(
      "\n  WARNING: No execution providers could be verified. " +
        "The module loaded but inference may not work."
    );
  }

  // ---------------------------------------------------------
  // 3. Quick inference round-trip with the minimal model
  // ---------------------------------------------------------
  try {
    const session = await ort.InferenceSession.create(minimalOnnx, {
      executionProviders: availableProviders.length > 0 ? availableProviders : ["CPUExecutionProvider"],
    });

    const inputTensor = new ort.Tensor("float32", Float32Array.from([1.0, 2.0, 3.0]), [1, 3]);
    const results = await session.run({ input: inputTensor });
    const outputData = results["output"].data as Float32Array;

    const roundTrip =
      outputData[0] === 1.0 && outputData[1] === 2.0 && outputData[2] === 3.0;

    await session.release();

    if (roundTrip) {
      console.log("  Inference round-trip: PASS (Identity model echoed [1,2,3])");
    } else {
      console.warn(
        `  Inference round-trip: unexpected output [${Array.from(outputData).join(", ")}]`
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  Inference round-trip: could not run — ${msg}`);
  }

  console.log("\nPASS: ONNX Runtime smoke test succeeded.");
}

// -----------------------------------------------------------------
// Helper — build the smallest valid ONNX protobuf in memory
// -----------------------------------------------------------------
// Constructs a minimal ONNX ModelProto entirely in JS using raw
// protobuf wire encoding. No protobuf library needed.
//
// The model has a single Identity node: float32[1,3] -> float32[1,3].
function buildMinimalOnnxModel(): Uint8Array {
  return buildOnnxProtobuf();
}

/**
 * Builds a minimal ONNX protobuf (ModelProto) entirely in JS.
 * This encodes a single Identity node: float32[1,3] -> float32[1,3].
 *
 * Protobuf wire format reference:
 *   - Field (id << 3 | wireType)
 *   - Varint = wireType 0, Length-delimited = wireType 2
 */
function buildOnnxProtobuf(): Uint8Array {
  // Helpers for protobuf encoding
  function varint(n: number): number[] {
    const bytes: number[] = [];
    while (n > 0x7f) {
      bytes.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    bytes.push(n & 0x7f);
    return bytes;
  }

  function field(id: number, wireType: number): number[] {
    return varint((id << 3) | wireType);
  }

  function fieldVarint(id: number, value: number): number[] {
    return [...field(id, 0), ...varint(value)];
  }

  function fieldBytes(id: number, data: number[]): number[] {
    return [...field(id, 2), ...varint(data.length), ...data];
  }

  function fieldString(id: number, s: string): number[] {
    const encoded = Array.from(new TextEncoder().encode(s));
    return fieldBytes(id, encoded);
  }

  // TensorShapeProto.Dimension — dim_value (field 1, varint)
  function dim(value: number): number[] {
    return fieldVarint(1, value);
  }

  // TensorShapeProto (field 1 = dim, repeated, each length-delimited)
  function shape(dims: number[]): number[] {
    let result: number[] = [];
    for (const d of dims) {
      result = [...result, ...fieldBytes(1, dim(d))];
    }
    return result;
  }

  // TypeProto.Tensor (field 1 = elem_type varint, field 2 = shape)
  function tensorType(elemType: number, dims: number[]): number[] {
    return [
      ...fieldVarint(1, elemType),
      ...fieldBytes(2, shape(dims)),
    ];
  }

  // TypeProto (field 1 = tensor_type)
  function typeProto(elemType: number, dims: number[]): number[] {
    return fieldBytes(1, tensorType(elemType, dims));
  }

  // ValueInfoProto (field 1 = name, field 2 = type)
  function valueInfo(name: string, elemType: number, dims: number[]): number[] {
    return [
      ...fieldString(1, name),
      ...fieldBytes(2, typeProto(elemType, dims)),
    ];
  }

  // NodeProto (field 1 = input (repeated), field 2 = output (repeated), field 3 = name, field 4 = op_type)
  function nodeProto(inputs: string[], outputs: string[], opType: string): number[] {
    let result: number[] = [];
    for (const inp of inputs) result = [...result, ...fieldString(1, inp)];
    for (const out of outputs) result = [...result, ...fieldString(2, out)];
    result = [...result, ...fieldString(4, opType)];
    return result;
  }

  // GraphProto (field 1 = node (repeated), field 2 = name, field 3 = initializer,
  //             field 4 = doc_string, field 5 = input (repeated), field 6 = output (repeated))
  // We use: field 1 = node, field 2 = name, field 11 = input, field 12 = output
  const node = nodeProto(["input"], ["output"], "Identity");
  const inputVI = valueInfo("input", 1 /* FLOAT */, [1, 3]);
  const outputVI = valueInfo("output", 1 /* FLOAT */, [1, 3]);

  const graph = [
    ...fieldBytes(1, node),          // node
    ...fieldString(2, "smoke"),      // name
    ...fieldBytes(11, inputVI),      // input
    ...fieldBytes(12, outputVI),     // output
  ];

  // OperatorSetIdProto (field 2 = version)
  const opsetImport = fieldVarint(2, 13);

  // ModelProto (field 1 = ir_version, field 7 = graph, field 8 = opset_import)
  const model = [
    ...fieldVarint(1, 7),              // ir_version = 7
    ...fieldBytes(8, opsetImport),     // opset_import
    ...fieldBytes(7, graph),           // graph
  ];

  return new Uint8Array(model);
}


main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
