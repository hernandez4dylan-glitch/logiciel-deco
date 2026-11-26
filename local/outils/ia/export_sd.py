"""Export Stable Diffusion 1.5 inpainting + LCM-LoRA vers ONNX (UNet, VAE) et
pré-encodage de la consigne d'optimisation (le logiciel n'a pas besoin du texte)."""
import torch, numpy as np, json, time, gc
from diffusers import StableDiffusionInpaintPipeline, LCMScheduler
torch.set_grad_enabled(False)
t = time.time()
pipe = StableDiffusionInpaintPipeline.from_pretrained("sd", variant="fp16", torch_dtype=torch.float32, safety_checker=None, requires_safety_checker=False)
pipe.load_lora_weights("lcm", weight_name="pytorch_lora_weights.safetensors")
pipe.fuse_lora()
pipe.unload_lora_weights()
print("chargé", round(time.time() - t), "s", flush=True)
CONSIGNE = ("professional interior architecture photograph, realistic, coherent contours, natural film grain, "
            "soft realistic contact shadows, same perspective, same framing, same existing lighting, "
            "same wall finishes, same objects layout, preserve identity of each item, preserve wallpaper pattern, "
            "preserve lime plaster texture")
NEGATIVE = "cartoon, painting, illustration, blurry, deformed, distorted, extra objects, text, watermark, oversaturated"
def enc(txt):
    ids = pipe.tokenizer(txt, padding="max_length", max_length=77, truncation=True, return_tensors="pt").input_ids
    return pipe.text_encoder(ids)[0].numpy().astype(np.float32)
np.savez("onnx/consigne.npz", positive=enc(CONSIGNE), negative=enc(NEGATIVE))
json.dump({"consigne_en": CONSIGNE, "negative": NEGATIVE}, open("onnx/consigne.json", "w"), ensure_ascii=False, indent=1)
print("consigne encodée", flush=True)
vae = pipe.vae.eval()
class Enc(torch.nn.Module):
    def __init__(s, v): super().__init__(); s.v = v
    def forward(s, x): return s.v.encode(x).latent_dist.mean * s.v.config.scaling_factor
class Dec(torch.nn.Module):
    def __init__(s, v): super().__init__(); s.v = v
    def forward(s, z): return s.v.decode(z / s.v.config.scaling_factor).sample
torch.onnx.export(Enc(vae), torch.randn(1, 3, 512, 512), "onnx/sd_vae_encodeur.onnx", input_names=["image"], output_names=["latent"],
                  dynamic_axes={"image": {2: "h", 3: "w"}, "latent": {2: "lh", 3: "lw"}}, opset_version=17)
torch.onnx.export(Dec(vae), torch.randn(1, 4, 64, 64), "onnx/sd_vae_decodeur.onnx", input_names=["latent"], output_names=["image"],
                  dynamic_axes={"latent": {2: "lh", 3: "lw"}, "image": {2: "h", 3: "w"}}, opset_version=17)
print("vae ok", flush=True)
unet = pipe.unet.eval()
del pipe.text_encoder, pipe.vae; gc.collect()
class U(torch.nn.Module):
    def __init__(s, u): super().__init__(); s.u = u
    def forward(s, x, t, e): return s.u(x, t, encoder_hidden_states=e).sample
import os; os.makedirs("onnx/unet", exist_ok=True)
torch.onnx.export(U(unet), (torch.randn(1, 9, 64, 64), torch.tensor([500], dtype=torch.int64), torch.randn(1, 77, 768)),
                  "onnx/unet/sd_unet.onnx", input_names=["latent", "temps", "texte"], output_names=["bruit"],
                  dynamic_axes={"latent": {0: "b", 2: "lh", 3: "lw"}, "temps": {0: "b"}, "texte": {0: "b"}, "bruit": {0: "b", 2: "lh", 3: "lw"}},
                  opset_version=17)
print("unet exporté", round(time.time() - t), "s", flush=True)
import onnx
m = onnx.load("onnx/unet/sd_unet.onnx", load_external_data=True)
onnx.save_model(m, "onnx/sd_unet.onnx", save_as_external_data=True, all_tensors_to_one_file=True, location="sd_unet.onnx.data", size_threshold=1024)
print("unet regroupé", round(time.time() - t), "s", flush=True)
json.dump(dict(pipe.scheduler.config), open("onnx/scheduler.json", "w"), indent=1, default=str)
