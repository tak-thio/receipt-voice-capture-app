class _Segment:
    def __init__(self, text: str, start: float, end: float) -> None:
        self.text = text
        self.start = start
        self.end = end


class _Info:
    def __init__(self, language: str) -> None:
        self.language = language


class WhisperModel:
    def __init__(self, model_name: str, device: str = "cpu", compute_type: str = "int8") -> None:
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type

    def transcribe(
        self,
        audio_path: str,
        beam_size: int = 5,
        language: str = "ja",
        condition_on_previous_text: bool = False,
    ):
        _ = (audio_path, beam_size, condition_on_previous_text)
        segments = [
            _Segment("これはテストです", 0.0, 1.25),
            _Segment("次へ", 1.25, 2.0),
        ]
        return segments, _Info(language)
