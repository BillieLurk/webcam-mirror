"""
Patch AveragePool ceil_mode=1 → ceil_mode=0 in the fp32 ONNX model.
WebGPU backend in ONNX Runtime Web doesn't implement the ceil_mode padding
variant of AveragePool kernel. For MobileNetV3 the pooling inputs are
even-sized so floor/ceil produce identical outputs.
"""
import onnx

MODEL = 'public/models/rvm_mobilenetv3_fp32.onnx'

model = onnx.load(MODEL)
patched = 0
for node in model.graph.node:
    if node.op_type == 'AveragePool':
        for attr in node.attribute:
            if attr.name == 'ceil_mode' and attr.i == 1:
                attr.i = 0
                patched += 1
                print(f'  Patched node: {node.name or "(unnamed)"}')

print(f'Patched {patched} AveragePool node(s)')
onnx.save(model, MODEL)
print(f'Saved to {MODEL}')
