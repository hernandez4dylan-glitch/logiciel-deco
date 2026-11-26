"""Export de l'auto-encodeur compact TAESD (madebyollin/taesd, MIT) en ONNX."""
import torch
from diffusers import AutoencoderTiny
torch.set_grad_enabled(False)
v = AutoencoderTiny.from_pretrained("taesd").eval()
class Enc(torch.nn.Module):
    def __init__(s, v): super().__init__(); s.v = v
    def forward(s, x): return s.v.encode(x).latents
class Dec(torch.nn.Module):
    def __init__(s, v): super().__init__(); s.v = v
    def forward(s, z): return s.v.decode(z).sample
torch.onnx.export(Enc(v), torch.randn(1, 3, 512, 512), "onnx/taesd_encodeur.onnx", input_names=["image"], output_names=["latent"],
                  dynamic_axes={"image": {2: "h", 3: "w"}, "latent": {2: "lh", 3: "lw"}}, opset_version=17)
torch.onnx.export(Dec(v), torch.randn(1, 4, 64, 64), "onnx/taesd_decodeur.onnx", input_names=["latent"], output_names=["image"],
                  dynamic_axes={"latent": {2: "lh", 3: "lw"}, "image": {2: "h", 3: "w"}}, opset_version=17)
