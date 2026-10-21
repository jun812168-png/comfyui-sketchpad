import base64
import io

import numpy as np
import torch
from PIL import Image


class SketchpadNode:
    """画板节点：前端用画笔/橡皮手绘，输出 IMAGE 供 Qwen Image 等作参考图。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "sketch_data": ("STRING", {"default": ""}),
                "width": ("INT", {"default": 1024, "min": 256, "max": 4096, "step": 64}),
                "height": ("INT", {"default": 1024, "min": 256, "max": 4096, "step": 64}),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("image", "width", "height")
    FUNCTION = "run"
    CATEGORY = "image/sketchpad"

    def run(self, sketch_data, width, height):
        img = None
        if isinstance(sketch_data, str) and sketch_data.startswith("data:image"):
            try:
                b64 = sketch_data.split(",", 1)[1]
                img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
            except Exception:
                img = None
        if img is None:
            img = Image.new("RGB", (width, height), (255, 255, 255))
        if img.size != (width, height):
            # 等比缩放 + 居中 + 白底填充：画稿形状永不变形
            scale = min(width / img.width, height / img.height)
            new_w = max(1, round(img.width * scale))
            new_h = max(1, round(img.height * scale))
            img = img.resize((new_w, new_h), Image.LANCZOS)
            canvas_img = Image.new("RGB", (width, height), (255, 255, 255))
            canvas_img.paste(img, ((width - new_w) // 2, (height - new_h) // 2))
            img = canvas_img
        arr = np.asarray(img).astype(np.float32) / 255.0
        tensor = torch.from_numpy(arr)[None,]
        # 通过 ui 通道把实际宽高推给前端：前端 onExecuted 收到后自动适配画板比例
        # （配合“把 width/height 转成输入并连接分辨率选择器”，运行一次画板即跟随）
        return {
            "ui": {"width": [int(width)], "height": [int(height)]},
            "result": (tensor, int(width), int(height)),
        }


NODE_CLASS_MAPPINGS = {"SketchpadNode": SketchpadNode}
NODE_DISPLAY_NAME_MAPPINGS = {"SketchpadNode": "🎨 画板 (笔刷/擦除)"}
