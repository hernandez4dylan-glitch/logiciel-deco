import torch, json, time
from transformers import UperNetForSemanticSegmentation, AutoModelForDepthEstimation
torch.set_grad_enabled(False)
seg = UperNetForSemanticSegmentation.from_pretrained("seg").eval()
labels = seg.config.id2label
print(len(labels), [labels[i] for i in range(15)])
json.dump({int(k): v for k, v in labels.items()}, open("onnx/ade20k_labels.json", "w"), ensure_ascii=False)
class S(torch.nn.Module):
    def __init__(s, m): super().__init__(); s.m = m
    def forward(s, x): return s.m(pixel_values=x).logits
x = torch.randn(1, 3, 576, 576)
torch.onnx.export(S(seg), x, "onnx/piece_segmentation.onnx", input_names=["image"], output_names=["logits"], opset_version=17)
dep = AutoModelForDepthEstimation.from_pretrained("depth").eval()
class D(torch.nn.Module):
    def __init__(s, m): super().__init__(); s.m = m
    def forward(s, x): return s.m(pixel_values=x).predicted_depth
x = torch.randn(1, 3, 518, 518)
torch.onnx.export(D(dep), x, "onnx/piece_profondeur.onnx", input_names=["image"], output_names=["depth"],
                  dynamic_axes={"image": {2: "h", 3: "w"}, "depth": {1: "h", 2: "w"}}, opset_version=17)
print("ok")
