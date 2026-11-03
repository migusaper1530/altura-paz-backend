package bo.altura.gis;
import java.util.Map;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
@RestController
public class GpxController {
    private final GpxService service;
    public GpxController(GpxService service) {this.service=service;}
    @GetMapping("/health") public Map<String,String> health() {return Map.of("status","ok","service","gis");}
    @PostMapping(value="/gpx/parse",consumes={"application/gpx+xml","application/xml","text/xml"})
    public Map<String,Object> parse(@RequestBody String xml) {return service.parse(xml);}
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String,String>> invalid(IllegalArgumentException e) {return ResponseEntity.unprocessableContent().body(Map.of("error",e.getMessage()));}
}
